import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, jsonSchema, Output, zodSchema } from "ai";
import { parseServerEnv } from "../../env";
import { LabelBatchOutput, type LabelGenerate } from "./label";

/** Модель проекта для текста (architecture/stack.md). Пишется в `joke_cards.labelModel`. */
export const LABEL_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 120_000;
// Пакет из 20 карточек: ~150 токенов на карточку, с запасом.
const MAX_OUTPUT_TOKENS = 8_192;

/**
 * Модели отдаём JSON Schema пакета, но SDK его НЕ валидирует: zod-схема в SDK отвергла бы весь
 * пакет из 20 карточек из-за одной кривой (длинный skeleton, перенос строки). Каждый элемент
 * проверяет `labelJokes` отдельно, до записи в БД.
 */
export const LABEL_BATCH_JSON_SCHEMA = jsonSchema<unknown>(
  () => zodSchema(LabelBatchOutput).jsonSchema,
);

/**
 * Реальный вызов (только оффлайн-скрипт `jokes:ingest`, в рантайме не используется).
 * Ключ читается при вызове, не при импорте, и в сообщения ошибок не попадает.
 */
export function createAnthropicLabelGenerate(): LabelGenerate {
  return async ({ system, user }) => {
    const apiKey = parseServerEnv(process.env).ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY не задан");
    const anthropic = createAnthropic({ apiKey });
    const { output } = await generateText({
      model: anthropic(LABEL_MODEL),
      system,
      messages: [{ role: "user", content: user }],
      output: Output.object({ schema: LABEL_BATCH_JSON_SCHEMA }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return output;
  };
}
