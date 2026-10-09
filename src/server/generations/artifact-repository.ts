import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type {
  Artifact,
  ArtifactImage,
  ArtifactKind,
  GenerationMode,
  GenerationStatusCode,
  RoastContent,
} from "@/contracts";
import { db, schema } from "../db";
import { timingsSql } from "./repository";

/** Всё, что нужно сборке. `profile` НЕ доверенный (jsonb): вызывающий парсит схемой. */
export type AssemblyInput = {
  status: GenerationStatusCode;
  tier: number | null;
  kind: ArtifactKind;
  mode: GenerationMode;
  igUsername: string;
  ownerTokenHash: string;
  profile: unknown;
  /** Выбранные шутки в порядке выбора человека. */
  selected: { punchId: string; emoji: string; text: string }[];
};

export type NewArtifact = {
  generationId: string;
  slug: string;
  kind: ArtifactKind;
  content: RoastContent;
  images: ArtifactImage[];
  /** Публичный `subject`, уже проверенный схемой `Artifact`: артефакт не зависит от `profile_checks`. */
  subject: Artifact["subject"];
  ownerTokenHash: string;
  now: Date;
};

export type ArtifactRepository = {
  /** `null`, если генерации нет. */
  loadInput(generationId: string): Promise<AssemblyInput | null>;
  /**
   * Атомарно: строка `artifacts` + `generations.status = ready`, `artifactId`, тайминги. Только если
   * генерация сейчас в `awaiting_selection` или `drawing`. `true` — записали этим вызовом; `false` —
   * статус другой (уже `ready` или `failed`) либо артефакт для генерации уже есть.
   */
  publish(input: NewArtifact): Promise<boolean>;
};

/**
 * SQL публикации. `art` (INSERT, только пока генерация в нужном статусе; повтор: `ON CONFLICT DO
 * NOTHING` по `generation_id`) → UPDATE генерации из `art`. Закрытая снаружи (`failed`) генерация
 * артефакта не получит: строка генерации берётся под `FOR UPDATE` до INSERT, поэтому параллельный
 * `markFailed` либо ждёт и видит `ready`, либо успевает первым, и тогда артефакт не вставляется
 * (без блокировки INSERT по старому снимку оставил бы сиротский публичный артефакт).
 */
export function publishSql(input: NewArtifact) {
  const at = input.now.toISOString();
  const timings = timingsSql({ finish: ["awaiting_selection", "draw"], now: input.now });
  return sql`
    WITH art AS (
      INSERT INTO artifacts (id, slug, generation_id, kind, content, images, subject, owner_token_hash, created_at)
      SELECT ${randomUUID()}, ${input.slug}, ${input.generationId}, ${input.kind}::artifact_kind, ${JSON.stringify(input.content)}::jsonb, ${JSON.stringify(input.images)}::jsonb, ${JSON.stringify(input.subject)}::jsonb, ${input.ownerTokenHash}, ${at}::timestamptz
      WHERE EXISTS (SELECT 1 FROM generations g WHERE g.id = ${input.generationId} AND g.status IN ('awaiting_selection', 'drawing') FOR UPDATE)
      ON CONFLICT (generation_id) DO NOTHING
      RETURNING id
    )
    UPDATE generations SET status = 'ready', artifact_id = (SELECT id FROM art), step_timings = ${timings}, updated_at = ${at}::timestamptz
    WHERE id = ${input.generationId} AND status IN ('awaiting_selection', 'drawing') AND EXISTS (SELECT 1 FROM art)
    RETURNING id`;
}

export function createArtifactRepository(): ArtifactRepository {
  return {
    async loadInput(generationId) {
      const [gen] = await db()
        .select({
          status: schema.generations.status,
          tier: schema.generations.tier,
          kind: schema.generations.kind,
          mode: schema.generations.mode,
          igUsername: schema.generations.igUsername,
          ownerTokenHash: schema.generations.ownerTokenHash,
          profile: schema.profileChecks.profile,
        })
        .from(schema.generations)
        .leftJoin(
          schema.profileChecks,
          eq(schema.profileChecks.id, schema.generations.profileCheckId),
        )
        .where(eq(schema.generations.id, generationId))
        .limit(1);
      if (!gen) return null;

      const selected = await db()
        .select({
          punchId: schema.punchCandidates.punchId,
          emoji: schema.punchCandidates.emoji,
          text: schema.punchCandidates.text,
        })
        .from(schema.punchCandidates)
        .where(
          and(
            eq(schema.punchCandidates.generationId, generationId),
            eq(schema.punchCandidates.selected, true),
          ),
        )
        .orderBy(schema.punchCandidates.selectionPosition);
      return { ...gen, selected };
    },

    async publish(input) {
      const result = await db().execute(publishSql(input));
      return result.rows.length > 0;
    },
  };
}
