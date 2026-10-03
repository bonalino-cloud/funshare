import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import type { ProfileSnapshot } from "@/contracts";
import { db, schema } from "../db";

export type SnapshotRow = { data: unknown; fetchedAt: Date };

export type SnapshotRepository = {
  /** Самый свежий снимок ника не старше `since`; `data` НЕ доверенный — вызывающий парсит. */
  findFresh(igUsername: string, since: Date): Promise<SnapshotRow | null>;
  insert(row: { igUsername: string; data: ProfileSnapshot; rawBlobKey: string }): Promise<void>;
};

export function createSnapshotRepository(): SnapshotRepository {
  return {
    async findFresh(igUsername, since) {
      const rows = await db()
        .select({
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

    async insert({ igUsername, data, rawBlobKey }) {
      await db()
        .insert(schema.profileSnapshots)
        .values({
          id: randomUUID(),
          igUsername,
          data,
          rawBlobKey,
          fetchedAt: new Date(data.fetchedAt),
        });
    },
  };
}
