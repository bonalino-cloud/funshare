import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { GenerationMode, Level, Tier } from "@/contracts";
import { db, schema } from "../../db";
import type { PunchTrace, WrittenCandidate } from "./types";

const { generations, profileChecks, profileSnapshots, personas, punchCandidates } = schema;

/** Вход шага `write` из БД. `snapshot` и `persona` НЕ доверенные (jsonb): вызывающий парсит. */
export type WriteInputRow = {
  tier: Tier;
  level: Level;
  mode: GenerationMode;
  extraFacts: string[];
  trialGenerationId: string | null;
  snapshot: unknown;
  persona: unknown;
};

/** Выбранная шутка Поджога. `trace` НЕ доверенный (jsonb). */
export type TrialPunchRow = { punchId: string; emoji: string; text: string; trace: unknown };

export type WriteRepository = {
  /** Кандидаты уже записаны (повтор шага после полного прогона не зовёт модель и ничего не пишет). */
  hasCandidates(generationId: string): Promise<boolean>;
  /** Вход шага; `null`, если строки, проверки профиля, снимка (его чистит Cron) или досье нет. */
  loadInput(generationId: string): Promise<WriteInputRow | null>;
  /** Выбранные шутки Поджога (`selected = true`) по порядку. */
  listSelected(generationId: string): Promise<TrialPunchRow[]>;
  /**
   * Все кандидаты одной SQL-командой (атомарно). Повтор не дублирует: конфликт
   * (`generationId`, `punchId`) пропускается.
   */
  saveCandidates(
    generationId: string,
    candidates: readonly WrittenCandidate[],
    promptVersion: string,
  ): Promise<void>;
};

export function createWriteRepository(): WriteRepository {
  return {
    async hasCandidates(generationId) {
      const rows = await db()
        .select({ id: punchCandidates.id })
        .from(punchCandidates)
        .where(eq(punchCandidates.generationId, generationId))
        .limit(1);
      return rows.length > 0;
    },

    async loadInput(generationId) {
      const [gen] = await db()
        .select({
          tier: generations.tier,
          level: generations.level,
          mode: generations.mode,
          extraFacts: generations.extraFacts,
          trialGenerationId: generations.trialGenerationId,
          snapshotId: profileChecks.snapshotId,
        })
        .from(generations)
        .leftJoin(profileChecks, eq(profileChecks.id, generations.profileCheckId))
        .where(eq(generations.id, generationId))
        .limit(1);
      if (!gen || gen.tier === null || gen.level === null || gen.snapshotId === null) return null;
      if (gen.tier !== 1 && gen.tier !== 2 && gen.tier !== 3) return null;

      const [snap] = await db()
        .select({ data: profileSnapshots.data })
        .from(profileSnapshots)
        .where(eq(profileSnapshots.id, gen.snapshotId))
        .limit(1);
      // Самое свежее досье этого снимка (версия промпта `analyze` может смениться).
      const [persona] = await db()
        .select({ data: personas.data })
        .from(personas)
        .where(eq(personas.snapshotId, gen.snapshotId))
        .orderBy(desc(personas.createdAt))
        .limit(1);
      if (!snap || !persona) return null;

      return {
        tier: gen.tier,
        level: gen.level,
        mode: gen.mode,
        extraFacts: gen.extraFacts,
        trialGenerationId: gen.trialGenerationId,
        snapshot: snap.data,
        persona: persona.data,
      };
    },

    async listSelected(generationId) {
      return db()
        .select({
          punchId: punchCandidates.punchId,
          emoji: punchCandidates.emoji,
          text: punchCandidates.text,
          trace: punchCandidates.trace,
        })
        .from(punchCandidates)
        .where(
          and(eq(punchCandidates.generationId, generationId), eq(punchCandidates.selected, true)),
        )
        .orderBy(punchCandidates.position);
    },

    async saveCandidates(generationId, candidates, promptVersion) {
      if (candidates.length === 0) return;
      await db()
        .insert(punchCandidates)
        .values(
          candidates.map((c, position) => ({
            id: randomUUID(),
            generationId,
            punchId: c.id,
            position,
            emoji: c.emoji,
            text: c.text,
            fromTrial: c.fromTrial,
            trace: c.trace satisfies PunchTrace,
            promptVersion,
          })),
        )
        .onConflictDoNothing({
          target: [punchCandidates.generationId, punchCandidates.punchId],
        });
    },
  };
}
