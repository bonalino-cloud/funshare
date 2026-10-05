import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  ArtifactKind,
  ErrorCode,
  GenerationMode,
  GenerationStatusCode,
  Level,
  Tier,
} from "@/contracts";
import { db, schema } from "../db";

/** Строка генерации для проверок владения и ответа GET. Хэши наружу не уходят. */
export type GenerationRow = {
  id: string;
  status: GenerationStatusCode;
  errorCode: ErrorCode | null;
  igUsername: string;
  /** `null` у строк, созданных до `be/p1-generations-api`. */
  tier: number | null;
  ownerTokenHash: string;
  /** Slug артефакта этой генерации (если он уже собран). */
  artifactSlug: string | null;
  updatedAt: Date;
};

/** Всё, что шагу `write` понадобится из запроса. Уже проверено и очищено вызывающим. */
export type NewGeneration = {
  id: string;
  igUsername: string;
  mode: GenerationMode;
  kind: ArtifactKind;
  profileCheckId: string;
  tier: Tier;
  level: Level;
  extraFacts: string[];
  /** Только прошедший проверку (тот же владелец и профиль, готовый Поджог) или `null`. */
  trialGenerationId: string | null;
  ownerTokenHash: string;
  ipHash: string;
};

/** Условный переход статуса шага конвейера (см. `GenerationRepository.advance`). */
export type Advance = {
  /** Менять только из этих статусов: повтор шага не откатывает и не перескакивает. */
  from: GenerationStatusCode[];
  to: GenerationStatusCode;
  /** Шаги, у которых проставить `startedAt` (уже стоящий не перезаписывается). */
  start?: string[];
  /** Шаги, у которых проставить `finishedAt` (у шага должен быть `startedAt`). */
  finish?: string[];
  now: Date;
};

export type GenerationRepository = {
  /** Строка со статусом `queued`. */
  insert(row: NewGeneration): Promise<void>;
  get(id: string): Promise<GenerationRow | null>;
  /** `failed` + код, пока артефакта нет (`ready` не трогаем). `true` — перевели сейчас. */
  markFailed(id: string, errorCode: ErrorCode, now: Date): Promise<boolean>;
  /**
   * Одна SQL-команда: статус + `stepTimings`, только если сейчас статус из `from`. `true` — перешли
   * сейчас; `false` — строки нет или статус уже другой (повтор, `failed`, дальше по конвейеру).
   */
  advance(id: string, input: Advance): Promise<boolean>;
};

/** Новое значение `step_timings`. Имена шагов — константы кода, но значения всё равно параметры. */
export function timingsSql(input: Pick<Advance, "start" | "finish" | "now">) {
  const at = input.now.toISOString();
  let timings = sql`${schema.generations.stepTimings}`;
  for (const step of input.start ?? []) {
    // Правый операнд `||` побеждает: уже записанный startedAt остаётся от первой попытки.
    timings = sql`(jsonb_build_object(${step}::text, jsonb_build_object('startedAt', ${at}::text)) || ${timings})`;
  }
  for (const step of input.finish ?? []) {
    // Уже стоящий finishedAt не трогаем: повтор шага не сдвигает время окончания.
    const path = `{${step},finishedAt}`;
    timings = sql`(CASE WHEN ${timings} #> ${path}::text[] IS NULL THEN jsonb_set(${timings}, ${path}::text[], to_jsonb(${at}::text)) ELSE ${timings} END)`;
  }
  return timings;
}

export function createGenerationRepository(): GenerationRepository {
  return {
    async insert(row) {
      await db()
        .insert(schema.generations)
        .values({ ...row, status: "queued" });
    },

    async get(id) {
      const rows = await db()
        .select({
          id: schema.generations.id,
          status: schema.generations.status,
          errorCode: schema.generations.errorCode,
          igUsername: schema.generations.igUsername,
          tier: schema.generations.tier,
          ownerTokenHash: schema.generations.ownerTokenHash,
          artifactSlug: schema.artifacts.slug,
          updatedAt: schema.generations.updatedAt,
        })
        .from(schema.generations)
        .leftJoin(schema.artifacts, eq(schema.artifacts.generationId, schema.generations.id))
        .where(eq(schema.generations.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async markFailed(id, errorCode, now) {
      const rows = await db()
        .update(schema.generations)
        .set({ status: "failed", errorCode, updatedAt: now })
        .where(and(eq(schema.generations.id, id), ne(schema.generations.status, "ready")))
        .returning({ id: schema.generations.id });
      return rows.length > 0;
    },

    async advance(id, input) {
      const rows = await db()
        .update(schema.generations)
        .set({ status: input.to, stepTimings: timingsSql(input), updatedAt: input.now })
        .where(and(eq(schema.generations.id, id), inArray(schema.generations.status, input.from)))
        .returning({ id: schema.generations.id });
      return rows.length > 0;
    },
  };
}

/** Идентификатор генерации: тот же способ, что у `profile_checks` (UUID v4). */
export const newGenerationId = () => randomUUID();
