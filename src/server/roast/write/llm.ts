import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, jsonSchema, NoObjectGeneratedError, Output, zodSchema } from "ai";
import type { z } from "zod";
import { LlmSchemaError } from "../../analyze/llm";
import { parseServerEnv } from "../../env";
import { JudgeOutput, ModeratorOutput, WriterOutput } from "./schema";

/** Модель писателя: как в `analyze` (architecture/stack.md). */
export const WRITER_MODEL = "claude-sonnet-5";
/** Судья: тот же класс; можно подменить на дешёвый через `WriteDeps`. */
export const JUDGE_MODEL = "claude-sonnet-5";

/** Модератор (слой 5): дешёвый класс, как судья; подменяется через `WriteDeps`. */
export const MODERATOR_MODEL = "claude-sonnet-5";

const TIMEOUT_MS = 90_000;
// Пачка: 5 крючков × 3 кандидата (~150 токенов с метками), либо 12 оценок судьи. С запасом.
const WRITER_MAX_OUTPUT_TOKENS = 8_192;
const JUDGE_MAX_OUTPUT_TOKENS = 4_096;
const MODERATOR_MAX_OUTPUT_TOKENS = 4_096;

export type PromptText = { system: string; user: string };
/** Возвращает НЕдоверенный объект: шаг парсит его сам. Сетевые сбои — обычное исключение. */
export type GenerateFn = (prompt: PromptText) => Promise<unknown>;

/**
 * Реальный вызов, AI SDK 7: `generateText` + `Output.object`. Схема уходит модели как JSON Schema,
 * но не валидируется SDK (см. schema.ts). Ключ читается при вызове и в ошибки не попадает.
 */
function createAnthropicJson(
  role: "писатель" | "судья" | "модератор",
  modelId: string,
  schema: z.ZodType,
  maxOutputTokens: number,
): GenerateFn {
  const output = Output.object({
    schema: jsonSchema<unknown>(() => zodSchema(schema).jsonSchema),
  });
  return async ({ system, user }) => {
    const apiKey = parseServerEnv(process.env).ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY не задан");
    const anthropic = createAnthropic({ apiKey });
    try {
      const result = await generateText({
        model: anthropic(modelId),
        system,
        messages: [{ role: "user", content: user }],
        output,
        maxOutputTokens,
        // Свой бюджет попыток ведёт шаг; SDK добавляет не больше одного повтора на сеть и 5xx.
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // Обрезка по лимиту токенов — главный враг пачек (урок судьи): всё, кроме stop, в лог.
      if (result.finishReason !== "stop") {
        console.error(`[write] ${role} ${modelId}: finishReason=${String(result.finishReason)}`);
      }
      return result.output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        // Только метаданные: ни текста ответа, ни данных профиля.
        const length = typeof error.text === "string" ? error.text.length : 0;
        const meta = `finishReason=${String(error.finishReason)}, длина ответа=${length}`;
        console.error(`[write] ${role} ${modelId}: ответ не по схеме (${meta})`);
        throw new LlmSchemaError(`ответ не является JSON по заданной схеме (${meta})`);
      }
      throw error;
    }
  };
}

export const createAnthropicWriter = (): GenerateFn =>
  createAnthropicJson("писатель", WRITER_MODEL, WriterOutput, WRITER_MAX_OUTPUT_TOKENS);
export const createAnthropicJudge = (): GenerateFn =>
  createAnthropicJson("судья", JUDGE_MODEL, JudgeOutput, JUDGE_MAX_OUTPUT_TOKENS);
export const createAnthropicModerator = (): GenerateFn =>
  createAnthropicJson("модератор", MODERATOR_MODEL, ModeratorOutput, MODERATOR_MAX_OUTPUT_TOKENS);
