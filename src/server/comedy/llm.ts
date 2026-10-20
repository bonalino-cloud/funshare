import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, jsonSchema, NoObjectGeneratedError, Output, zodSchema } from "ai";
import type { z } from "zod";
import { LlmSchemaError } from "../analyze/llm";
import type { CostMeter, LlmRole, SdkUsage } from "../cost/meter";
import { parseServerEnv } from "../env";
import { withCanary, type CanaryRole } from "../prompts/canary";
import { MIN_CALL_MS } from "./config";
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

/** Модели comedy-движка (§1): сочиняет и оценивает Sonnet 5.5, модерирует Haiku 5.5. */
export const SONNET_MODEL = "claude-sonnet-5-5";
export const HAIKU_MODEL = "claude-haiku-5-5";

export type ComedyRole = "profile" | "insights" | "select" | "punch" | "editor" | "moderator";

/**
 * Режим размышлений (`providerOptions.anthropic.thinking.type`). Sonnet 5.5 не принимает
 * `disabled` (400): его минимум `between_tools`, без размышлений перед ответом. Haiku 5.5
 * принимает `disabled`. `adaptive` — модель сама решает, сколько думать (дольше и дороже).
 */
export type ThinkingMode = "between_tools" | "disabled" | "adaptive";
/** `between_tools` и `disabled` работают только при effort не выше `high`: выше не пускаем. */
export type Effort = "low" | "medium" | "high";

type RoleConfig = {
  model: string;
  thinking: ThinkingMode;
  effort: Effort;
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

// ЕДИНСТВЕННОЕ место, где выбираются модель, размышления и effort каждой роли. Включить
// adaptive на генераторе — заменить `thinking` в строке `punch`. Замер 2026-10-17: Sonnet 5
// ~54 ток/с, Sonnet 5.5 ~84, Haiku 5.5 ~133.
// Профиль: до 45 фактов по ~140 знаков кириллицы плюс цитаты и 13 картинок на входе. Инсайты:
// до 12 на категорию. Генератор: 3 инсайта × 3 шутки. Редактор: до 30 оценок.
const ROLES: Record<ComedyRole, RoleConfig> = {
  profile: {
    model: SONNET_MODEL,
    thinking: "between_tools",
    effort: "medium",
    meter: "comedy-profile",
    canary: "analyze",
    schema: ProfileOutput,
    maxOutputTokens: 12_288,
    timeoutMs: 150_000,
  },
  insights: {
    model: SONNET_MODEL,
    thinking: "between_tools",
    effort: "high",
    meter: "comedy-insights",
    canary: "writer",
    schema: InsightsOutput,
    maxOutputTokens: 8_192,
    timeoutMs: 90_000,
  },
  select: {
    model: SONNET_MODEL,
    thinking: "between_tools",
    effort: "medium",
    meter: "comedy-select",
    canary: "judge",
    schema: SelectOutput,
    maxOutputTokens: 4_096,
    timeoutMs: 60_000,
  },
  punch: {
    model: SONNET_MODEL,
    thinking: "between_tools",
    effort: "high",
    meter: "comedy-punch",
    canary: "writer",
    schema: PunchOutput,
    maxOutputTokens: 8_192,
    timeoutMs: 90_000,
  },
  editor: {
    model: SONNET_MODEL,
    thinking: "between_tools",
    effort: "high",
    meter: "comedy-editor",
    canary: "judge",
    schema: EditorOutput,
    maxOutputTokens: 8_192,
    timeoutMs: 90_000,
  },
  moderator: {
    model: HAIKU_MODEL,
    thinking: "disabled",
    effort: "low",
    meter: "comedy-moderator",
    canary: "moderator",
    schema: ModeratorOutput,
    maxOutputTokens: 4_096,
    timeoutMs: 60_000,
  },
};

export const COMEDY_ROLES = Object.keys(ROLES) as ComedyRole[];

/** Модель каждой роли: в трассу шага `comedy` и в `PunchTrace`. */
export function comedyModels(): Record<ComedyRole, string> {
  return Object.fromEntries(COMEDY_ROLES.map((r) => [r, ROLES[r].model])) as Record<
    ComedyRole,
    string
  >;
}

export function comedyRoleConfig(role: ComedyRole): Readonly<RoleConfig> {
  return ROLES[role];
}

/** Бюджет запуска исчерпан: вызов не начат и денег не стоит. Шаг считает это сбоем вызова. */
export class ComedyDeadlineError extends Error {
  constructor() {
    super("бюджет времени comedy исчерпан");
    this.name = "ComedyDeadlineError";
  }
}

/** Таймаут вызова: таймаут роли, но не дальше общего срока запуска (`deadlineAt`, мс эпохи). */
function callTimeoutMs(roleMs: number, deadlineAt: number | undefined): number {
  if (deadlineAt === undefined) return roleMs;
  const left = deadlineAt - Date.now();
  if (left < MIN_CALL_MS) throw new ComedyDeadlineError();
  return Math.min(roleMs, left);
}

function toContent(parts: readonly PromptPart[]) {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : { type: "file" as const, mediaType: part.mediaType, data: part.data },
  );
}

/**
 * Реальный вызов одной роли. Модель, размышления и effort — из конфига роли. Неудачная попытка
 * тоже идёт в счётчик (с моделью роли): она стоит денег. `deadlineAt` (мс эпохи) — общий срок
 * всех вызовов запуска (`COMEDY_BUDGET_MS`): после него вызовы не начинаются
 * (`ComedyDeadlineError`), а начатый обрывается на сроке.
 */
export function createComedyGenerate(
  role: ComedyRole,
  options: { meter?: CostMeter; deadlineAt?: number } = {},
): ComedyGenerateFn {
  const { meter, deadlineAt } = options;
  const cfg = ROLES[role];
  const modelId = cfg.model;
  const providerOptions = {
    anthropic: { thinking: { type: cfg.thinking }, effort: cfg.effort },
  };
  const output = Output.object({
    schema: jsonSchema<unknown>(() => zodSchema(cfg.schema).jsonSchema),
  });
  return async ({ system, parts }) => {
    const timeoutMs = callTimeoutMs(cfg.timeoutMs, deadlineAt);
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
        providerOptions,
        // Свой бюджет попыток ведёт шаг; SDK добавляет не больше одного повтора на сеть и 5xx.
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(timeoutMs),
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
