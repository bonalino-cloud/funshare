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

/** Кандидат для `GET …/candidates`. Оценки и трасса сюда не попадают (инвариант 20). */
export type CandidateRow = { punchId: string; emoji: string; text: string; fromTrial: boolean };

/** Выбор человека, уже проверенный вызывающим (id этой генерации, без дублей, число в пределах). */
export type SelectionInput = {
  generationId: string;
  /** В порядке артефакта. */
  punchIds: string[];
  /** Потолок тарифа: страховка внутри SQL на случай гонки. */
  max: number;
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
  /** Кандидаты генерации по порядку. */
  listCandidates(generationId: string): Promise<CandidateRow[]>;
  /** `punchId` выбранных шуток в порядке выбора; пусто, пока выбор не принят. */
  listSelection(generationId: string): Promise<string[]>;
  /**
   * Принять выбор одной SQL-командой: закрыть тайминг `awaiting_selection` (это и есть «замок»:
   * условие `finishedAt IS NULL`) и проставить `selected`/`selectionPosition`. `true` — выбор принят
   * именно этим вызовом; `false` — статус не `awaiting_selection`, выбор уже принят (другим или
   * этим же запросом ранее) или id не из этой генерации.
   */
  submitSelection(input: SelectionInput): Promise<boolean>;
};

/**
 * SQL приёма выбора. Одна команда = одна транзакция: `claim` (UPDATE строки генерации, берёт её
 * блокировку) → UPDATE кандидатов из `claim`. Два одновременных POST: второй UPDATE ждёт блокировку,
 * перечитывает условие `finishedAt IS NULL` уже по новой версии строки и получает 0 строк, поэтому
 * принят ровно один выбор. Число совпавших id проверяется тут же: частично чужой список не принимается.
 */
export function submitSelectionSql(input: SelectionInput) {
  const values = sql.join(
    input.punchIds.map((id, i) => sql`(${id}::text, ${i + 1}::int)`),
    sql`, `,
  );
  const timings = timingsSql({
    start: ["awaiting_selection"],
    finish: ["awaiting_selection"],
    now: input.now,
  });
  return sql`
    WITH v(punch_id, pos) AS (VALUES ${values}),
    claim AS (
      UPDATE generations SET step_timings = ${timings}, updated_at = ${input.now.toISOString()}::timestamptz
      WHERE id = ${input.generationId}
        AND status = 'awaiting_selection'
        AND step_timings #> '{awaiting_selection,finishedAt}' IS NULL
        AND ${input.punchIds.length}::int <= ${input.max}::int
        AND (SELECT count(*) FROM punch_candidates c WHERE c.generation_id = ${input.generationId} AND c.punch_id IN (SELECT punch_id FROM v)) = ${input.punchIds.length}::int
      RETURNING id
    )
    UPDATE punch_candidates c SET selected = true, selection_position = v.pos
    FROM v, claim
    WHERE c.generation_id = claim.id AND c.punch_id = v.punch_id
    RETURNING c.punch_id`;
}

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

    async listCandidates(generationId) {
      return db()
        .select({
          punchId: schema.punchCandidates.punchId,
          emoji: schema.punchCandidates.emoji,
          text: schema.punchCandidates.text,
          fromTrial: schema.punchCandidates.fromTrial,
        })
        .from(schema.punchCandidates)
        .where(eq(schema.punchCandidates.generationId, generationId))
        .orderBy(schema.punchCandidates.position);
    },

    async listSelection(generationId) {
      const rows = await db()
        .select({ punchId: schema.punchCandidates.punchId })
        .from(schema.punchCandidates)
        .where(
          and(
            eq(schema.punchCandidates.generationId, generationId),
            eq(schema.punchCandidates.selected, true),
          ),
        )
        .orderBy(schema.punchCandidates.selectionPosition);
      return rows.map((r) => r.punchId);
    },

    async submitSelection(input) {
      if (input.punchIds.length === 0) return false;
      const result = await db().execute(submitSelectionSql(input));
      return (result.rows as { punch_id: string }[]).length === input.punchIds.length;
    },
  };
}

/** Идентификатор генерации: тот же способ, что у `profile_checks` (UUID v4). */
export const newGenerationId = () => randomUUID();
