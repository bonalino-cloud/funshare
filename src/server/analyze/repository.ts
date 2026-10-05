import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { PersonaProfile } from "@/contracts";
import { db, schema } from "../db";

export type PersonaRow = { data: unknown; model: string; promptVersion: string };

export type PersonaRepository = {
  /** Досье этого снимка и версии промпта; `data` НЕ доверенный — вызывающий парсит. */
  find(snapshotId: string, promptVersion: string): Promise<PersonaRow | null>;
  /** Upsert по (snapshotId, promptVersion): повтор не плодит дубли (инвариант 8). */
  save(row: {
    snapshotId: string;
    data: PersonaProfile;
    model: string;
    promptVersion: string;
  }): Promise<void>;
};

export function createPersonaRepository(): PersonaRepository {
  return {
    async find(snapshotId, promptVersion) {
      const rows = await db()
        .select({
          data: schema.personas.data,
          model: schema.personas.model,
          promptVersion: schema.personas.promptVersion,
        })
        .from(schema.personas)
        .where(
          and(
            eq(schema.personas.snapshotId, snapshotId),
            eq(schema.personas.promptVersion, promptVersion),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async save({ snapshotId, data, model, promptVersion }) {
      await db()
        .insert(schema.personas)
        .values({ id: randomUUID(), snapshotId, data, model, promptVersion })
        .onConflictDoUpdate({
          target: [schema.personas.snapshotId, schema.personas.promptVersion],
          // id не трогаем: ссылки на досье остаются стабильными.
          set: { data, model, createdAt: new Date() },
        });
    },
  };
}
