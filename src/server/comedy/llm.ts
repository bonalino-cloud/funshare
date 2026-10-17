import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, jsonSchema, NoObjectGeneratedError, Output, zodSchema } from "ai";
import type { z } from "zod";
import { LlmSchemaError } from "../analyze/llm";
import type { CostMeter, LlmRole, SdkUsage } from "../cost/meter";
import { parseServerEnv } from "../env";
import { withCanary, type CanaryRole } from "../prompts/canary";
import {
  EditorOutput,
  InsightsOutput,
  ModeratorOutput,
  ProfileOutput,
  PunchOutput,
  SelectOutput,
} from "./schema";
import type { ComedyGenerateFn, PromptPart } from "./types";

// Вызовы Anthropic comedy-движка (comedy-engine §1, §8): AI SDK 7, `generateText` +
// `Output.object`. Схема уходит модели как JSON Schema, но SDK ответ НЕ валидирует: каждый
// элемент проверяет код (schema.ts). Ключ читается при вызове и в ошибки не попадает.

/** Модель всех шагов comedy-движка (§1). */
export const COMEDY_MODEL = "claude-sonnet-5";

export type ComedyRole = "profile" | "insights" | "select" | "punch" | "editor" | "moderator";

type RoleConfig = {
  /** Роль счётчика трат (`generations.cost_detail`). */
  meter: LlmRole;
  /**
   * Canary-метка: отдельных меток у comedy нет, берётся метка той же природы (исследование →
   * `analyze`, сочинение → `writer`, оценка → `judge`, модерация → `moderator`). Слой 4 и CI
   * ищут все метки, поэтому утечку поймают при любой.
   */
  canary: CanaryRole;
  schema: z.ZodType;
  maxOutputTokens: number;
  timeoutMs: number;
};

// Профиль: до 60 фактов по ~180 знаков кириллицы плюс цитаты (~10k токенов) и 13 картинок на
// входе. Инсайты: до 14 на категорию. Генератор: 5 инсайтов × 3 шутки. Редактор: до 30 оценок.
const ROLES: Record<ComedyRole, RoleConfig> = {
  profile: {
    meter: "comedy-profile",
    canary: "analyze",
    schema: ProfileOutput,
    maxOutputTokens: 16_384,
    timeoutMs: 150_000,
  },
  insights: {
    meter: "comedy-insights",
    canary: "writer",
    schema: InsightsOutput,
    maxOutputTokens: 8_192,
    timeoutMs: 90_000,
  },
  select: {
    meter: "comedy-select",
    canary: "judge",
    schema: SelectOutput,
    maxOutputTokens: 4_096,
    timeoutMs: 60_000,
  },
  punch: {
    meter: "comedy-punch",
    canary: "writer",
    schema: PunchOutput,
    maxOutputTokens: 8_192,
    timeoutMs: 90_000,
  },
  editor: {
    meter: "comedy-editor",
    canary: "judge",
    schema: EditorOutput,
    maxOutputTokens: 8_192,
    timeoutMs: 90_000,
  },
  moderator: {
    meter: "comedy-moderator",
    canary: "moderator",
    schema: ModeratorOutput,
    maxOutputTokens: 4_096,
    timeoutMs: 60_000,
  },
};

export function comedyRoleConfig(role: ComedyRole): Readonly<RoleConfig> {
  return ROLES[role];
}

function toContent(parts: readonly PromptPart[]) {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : { type: "file" as const, mediaType: part.mediaType, data: part.data },
  );
}

/** Реальный вызов одной роли. Неудачная попытка тоже идёт в счётчик: она стоит денег. */
export function createComedyGenerate(
  role: ComedyRole,
  meter?: CostMeter,
  modelId: string = COMEDY_MODEL,
): ComedyGenerateFn {
  const cfg = ROLES[role];
  const output = Output.object({
    schema: jsonSchema<unknown>(() => zodSchema(cfg.schema).jsonSchema),
  });
  return async ({ system, parts }) => {
    const apiKey = parseServerEnv(process.env).ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY не задан");
    const anthropic = createAnthropic({ apiKey });
    let usage: SdkUsage | undefined;
    try {
      const result = await generateText({
        model: anthropic(modelId),
        system: withCanary(system, cfg.canary),
        messages: [{ role: "user", content: toContent(parts) }],
        output,
        maxOutputTokens: cfg.maxOutputTokens,
        // Свой бюджет попыток ведёт шаг; SDK добавляет не больше одного повтора на сеть и 5xx.
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(cfg.timeoutMs),
      });
      usage = result.totalUsage;
      if (result.finishReason !== "stop") {
        console.error(`[comedy] ${role} ${modelId}: finishReason=${String(result.finishReason)}`);
      }
      // Геттер бросает, если вывода нет: учёт успеха после него, иначе вызов посчитался бы дважды.
      const parsed: unknown = result.output;
      meter?.recordLlm({ role: cfg.meter, model: modelId, usage, ok: true });
      return parsed;
    } catch (error) {
      meter?.recordLlm({
        role: cfg.meter,
        model: modelId,
        usage: NoObjectGeneratedError.isInstance(error) ? error.usage : usage,
        ok: false,
      });
      if (NoObjectGeneratedError.isInstance(error)) {
        // Только метаданные: ни текста ответа, ни данных профиля.
        const length = typeof error.text === "string" ? error.text.length : 0;
        const meta = `finishReason=${String(error.finishReason)}, длина ответа=${length}`;
        console.error(`[comedy] ${role} ${modelId}: ответ не по схеме (${meta})`);
        throw new LlmSchemaError(`ответ не является JSON по заданной схеме (${meta})`);
      }
      throw error;
    }
  };
}
