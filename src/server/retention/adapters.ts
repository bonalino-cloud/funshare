import { BlobNotFoundError, del, head, list } from "@vercel/blob";
import { inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { parseServerEnv } from "../env";
import { rawBlobToken } from "../scrape/blob";
import type { RetentionBlobStore, RetentionDb } from "./run";

const { artifacts, generationTraces, profileChecks, profileSnapshots } = schema;

/** Один DELETE с подзапросом на пачку: без гонки «выбрали id — кто-то удалил». */
export const retentionDb: RetentionDb = {
  async deleteTraces(cutoff, limit) {
    const rows = await db()
      .delete(generationTraces)
      .where(
        inArray(
          generationTraces.id,
          db()
            .select({ id: generationTraces.id })
            .from(generationTraces)
            .where(lt(generationTraces.createdAt, cutoff))
            .limit(limit),
        ),
      )
      .returning({ id: generationTraces.id });
    return rows.length;
  },

  async deleteSnapshots(cutoff, limit) {
    // Каскад: personas и dossier_runs уходят вместе со снимком; profile_checks.snapshot_id → null.
    const rows = await db()
      .delete(profileSnapshots)
      .where(
        inArray(
          profileSnapshots.id,
          db()
            .select({ id: profileSnapshots.id })
            .from(profileSnapshots)
            .where(lt(profileSnapshots.fetchedAt, cutoff))
            .limit(limit),
        ),
      )
      .returning({ id: profileSnapshots.id });
    return rows.length;
  },

  async clearAvatarUrls(urls) {
    if (urls.length === 0) return 0;
    // jsonb_set меняет только avatarUrl; совпадение по точному URL, поэтому чужой аватар не страдает.
    const subjects = await db()
      .update(artifacts)
      .set({ subject: sql`jsonb_set(${artifacts.subject}, '{avatarUrl}', 'null'::jsonb)` })
      .where(inArray(sql`${artifacts.subject}->>'avatarUrl'`, urls))
      .returning({ id: artifacts.id });
    const checks = await db()
      .update(profileChecks)
      .set({ profile: sql`jsonb_set(${profileChecks.profile}, '{avatarUrl}', 'null'::jsonb)` })
      .where(inArray(sql`${profileChecks.profile}->>'avatarUrl'`, urls))
      .returning({ id: profileChecks.id });
    return subjects.length + checks.length;
  },
};

function blobStore(token: string): RetentionBlobStore {
  return {
    async list({ prefix, cursor, limit }) {
      const page = await list({ token, prefix, cursor, limit });
      return {
        blobs: page.blobs.map((b) => ({
          url: b.url,
          pathname: b.pathname,
          uploadedAt: b.uploadedAt,
        })),
        cursor: page.cursor,
        hasMore: page.hasMore,
      };
    },
    async head(url) {
      try {
        const meta = await head(url, { token });
        return { uploadedAt: meta.uploadedAt };
      } catch (error) {
        // SDK не задаёт `error.name` (у всех его ошибок он "Error"): только `instanceof`.
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
    async del(urls) {
      await del(urls, { token });
    },
  };
}

/** Private store сырья: только `BLOB_RAW_READ_WRITE_TOKEN` (без него SDK смотрит в public store). */
export const rawStore = (): RetentionBlobStore => blobStore(rawBlobToken());

/** Public store аватаров: `BLOB_READ_WRITE_TOKEN`. */
export function avatarStore(): RetentionBlobStore {
  const token = parseServerEnv(process.env).BLOB_READ_WRITE_TOKEN;
  if (!token) {
    const error = new Error("BLOB_READ_WRITE_TOKEN is not set");
    error.name = "AvatarBlobTokenMissing";
    throw error;
  }
  return blobStore(token);
}
