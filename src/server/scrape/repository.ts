import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import type { ProfileSnapshot } from "@/contracts";
import { db, schema } from "../db";

export type SnapshotRow = { id: string; data: unknown; fetchedAt: Date };

export type SnapshotRepository = {
  /** Самый свежий снимок ника не старше `since`; `data` НЕ доверенный — вызывающий парсит. */
  findFresh(igUsername: string, since: Date): Promise<SnapshotRow | null>;
  /** Снимок по id (досье строится по снимку проверки); `data` НЕ доверенный. */
  findById(id: string): Promise<SnapshotRow | null>;
  /** Возвращает `id` новой записи: по нему шаги дальше (analyze) привязывают досье к снимку. */
  insert(row: { igUsername: string; data: ProfileSnapshot; rawBlobKey: string }): Promise<string>;
};

export function createSnapshotRepository(): SnapshotRepository {
  return {
    async findFresh(igUsername, since) {
      const rows = await db()
        .select({
          id: schema.profileSnapshots.id,
          data: schema.profileSnapshots.data,
          fetchedAt: schema.profileSnapshots.fetchedAt,
        })
        .from(schema.profileSnapshots)
        .where(
          and(
            eq(schema.profileSnapshots.igUsername, igUsername),
            gte(schema.profileSnapshots.fetchedAt, since),
          ),
        )
        .orderBy(desc(schema.profileSnapshots.fetchedAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async findById(id) {
      const rows = await db()
        .select({
          id: schema.profileSnapshots.id,
          data: schema.profileSnapshots.data,
          fetchedAt: schema.profileSnapshots.fetchedAt,
        })
        .from(schema.profileSnapshots)
        .where(eq(schema.profileSnapshots.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async insert({ igUsername, data, rawBlobKey }) {
      const id = randomUUID();
      await db()
        .insert(schema.profileSnapshots)
        .values({
          id,
          igUsername,
          data,
          rawBlobKey,
          fetchedAt: new Date(data.fetchedAt),
        });
      return id;
    },
  };
}
