import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { CostMeter, SdkUsage } from "../cost/meter";
import { parseServerEnv } from "../env";
import { withCanary } from "../prompts/canary";
import type { AnalyzePromptPart } from "../prompts/active";
import { LlmDossier } from "./schema";

/**
 * Модель досье. Пишется в `personas.model`. С 2026-10-17 Sonnet 5.5: `claude-sonnet-5` на этой
 * структурной схеме обрывал ответ («other side closed» на ~31-й секунде, 3 попытки из 3), Sonnet
 * 5.5 отвечает за ~15 с. Цена та же (`cost/prices.ts`).
 */
export const ANALYZE_MODEL = "claude-sonnet-5-5";
/**
 * Размышления досье: минимум Sonnet 5.5 (`disabled` у него даёт 400), как у ролей comedy
 * (`comedy/llm.ts`). Задача структурная, важна скорость; effort по умолчанию API (high) допустим.
 */
const ANALYZE_PROVIDER_OPTIONS = { anthropic: { thinking: { type: "between_tools" } } };
/** Таймаут одной попытки (вместе с ретраем SDK): от него считается худший случай досье. */
export const ANALYZE_TIMEOUT_MS = 90_000;
// Полное досье по верхним лимитам контракта на кириллице — до ~7k токенов; обрезанный JSON
// = NoObjectGeneratedError и три одинаковых провала подряд.
const MAX_OUTPUT_TOKENS = 8_192;

/** Ответ модели не прошёл схему: можно повторить, сообщив причину. Сырого ответа здесь нет. */
export class LlmSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmSchemaError";
  }
}

export type GenerateInput = { system: string; parts: AnalyzePromptPart[] };
/** Возвращает НЕдоверенный объект: шаг парсит его сам. Сетевые сбои — обычное исключение. */
export type GenerateFn = (input: GenerateInput) => Promise<unknown>;

/**
 * Реальный вызов: AI SDK 7, `generateText` + `Output.object` (`generateObject` в этой версии
 * убран из документации). Ключ читается при вызове, не при импорте; в сообщения ошибок не попадает.
 * Картинки уходят байтами: их скачивает наш сервер (cover-fetch.ts).
 */
export function createAnthropicGenerate(meter?: CostMeter): GenerateFn {
  return async ({ system, parts }) => {
    const apiKey = parseServerEnv(process.env).ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY не задан");
    const anthropic = createAnthropic({ apiKey });

    // usage успешного ответа: если `result.output` бросит (нет вывода), токены всё равно учтём.
    let usage: SdkUsage | undefined;
    try {
      const result = await generateText({
        model: anthropic(ANALYZE_MODEL),
        system: withCanary(system, "analyze"),
        messages: [
          {
            role: "user",
            content: parts.map((part) =>
              part.type === "text"
                ? { type: "text" as const, text: part.text }
                : { type: "file" as const, mediaType: part.mediaType, data: part.data },
            ),
          },
        ],
        output: Output.object({ schema: LlmDossier }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        providerOptions: ANALYZE_PROVIDER_OPTIONS,
        // Ретраи на уровне SDK (сеть, 5xx) ограничены одним: свой бюджет попыток ведёт шаг.
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
      });
      usage = result.totalUsage;
      // Геттер бросает NoOutputGeneratedError, если вывода нет: учёт после него, иначе вызов
      // посчитался бы дважды (успехом и провалом).
      const output: unknown = result.output;
      meter?.recordLlm({ role: "analyze", model: ANALYZE_MODEL, usage, ok: true });
      return output;
    } catch (error) {
      // Неудачная попытка тоже стоит денег (повторы ведёт шаг): токены есть, если ответ дошёл.
      meter?.recordLlm({
        role: "analyze",
        model: ANALYZE_MODEL,
        usage: NoObjectGeneratedError.isInstance(error) ? error.usage : usage,
        ok: false,
      });
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new LlmSchemaError("ответ не является JSON по заданной схеме");
      }
      throw error;
    }
  };
}
