import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { parseServerEnv } from "../env";
import type { AnalyzePromptPart } from "../prompts/analyze/v1";
import { LlmDossier } from "./schema";

/** Модель досье (architecture/stack.md). Пишется в `personas.model`. */
export const ANALYZE_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 90_000;
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
export function createAnthropicGenerate(): GenerateFn {
  return async ({ system, parts }) => {
    const apiKey = parseServerEnv(process.env).ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY не задан");
    const anthropic = createAnthropic({ apiKey });

    try {
      const { output } = await generateText({
        model: anthropic(ANALYZE_MODEL),
        system,
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
        // Ретраи на уровне SDK (сеть, 5xx) ограничены одним: свой бюджет попыток ведёт шаг.
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new LlmSchemaError("ответ не является JSON по заданной схеме");
      }
      throw error;
    }
  };
}
