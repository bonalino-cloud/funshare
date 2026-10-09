import { drizzle } from "drizzle-orm/neon-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxDuration } from "@/app/api/cron/retention/route";
import { MAX_DURATION_SECONDS } from "./config";

const calls: { sql: string; params: unknown[] }[] = [];

// Настоящий построитель запросов Drizzle поверх заглушки клиента: смотрим итоговый SQL.
vi.mock("../db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db")>();
  const client = Object.assign(
    async (query: string, params: unknown[]) => {
      calls.push({ sql: query, params });
      return { rows: [], fields: [], rowCount: 0 };
    },
    { transaction: async () => [] },
  );
  const fake = drizzle(client as never, { schema: original.schema });
  return { ...original, db: () => fake };
});

const blobHead = vi.fn();
vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  head: (...args: unknown[]) => blobHead(...args),
}));

import { BlobNotFoundError, BlobServiceRateLimited } from "@vercel/blob";
import { avatarStore, retentionDb } from "./adapters";

const flat = (text: string) => text.replace(/\s+/g, " ");

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SQL чистки", () => {
  it("clearAvatarUrls: меняет только avatarUrl и только у точных совпадений URL", async () => {
    const urls = ["https://a.public.blob.vercel-storage.com/avatars/h1"];
    await retentionDb.clearAvatarUrls(urls);
    expect(calls).toHaveLength(2);
    const [artifacts, checks] = calls.map((c) => flat(c.sql));
    expect(artifacts).toContain(
      'update "artifacts" set "subject" = jsonb_set("artifacts"."subject"',
    );
    expect(artifacts).toContain("'{avatarUrl}', 'null'::jsonb");
    expect(artifacts).toContain(`"artifacts"."subject"->>'avatarUrl' in ($1)`);
    expect(checks).toContain('update "profile_checks" set "profile" = jsonb_set(');
    expect(checks).toContain(`"profile_checks"."profile"->>'avatarUrl' in ($`);
    expect(calls[0]?.params).toContain(urls[0]);
    expect(calls[1]?.params).toContain(urls[0]);
  });

  it("clearAvatarUrls без URL не ходит в БД", async () => {
    await retentionDb.clearAvatarUrls([]);
    expect(calls).toHaveLength(0);
  });

  it("трассы и снимки: один DELETE с подзапросом, строго старше cutoff, лимит пачки", async () => {
    const cutoff = new Date("2026-09-09T03:00:00.000Z");
    await retentionDb.deleteTraces(cutoff, 500);
    await retentionDb.deleteSnapshots(cutoff, 500);
    const [traces, snapshots] = calls.map((c) => flat(c.sql));
    expect(traces).toContain('delete from "generation_traces" where "generation_traces"."id" in');
    expect(traces).toContain('"generation_traces"."created_at" < $1');
    expect(traces).toContain("limit $2");
    expect(snapshots).toContain(
      'delete from "profile_snapshots" where "profile_snapshots"."id" in',
    );
    expect(snapshots).toContain('"profile_snapshots"."fetched_at" < $1');
  });
});

it("maxDuration маршрута совпадает с бюджетом в config.ts", () => {
  expect(maxDuration).toBe(MAX_DURATION_SECONDS);
});

describe("head аватара", () => {
  it("файла нет (BlobNotFoundError, у которого name = Error) → null; другой сбой пробрасывается", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    const store = avatarStore();
    blobHead.mockRejectedValueOnce(new BlobNotFoundError());
    await expect(store.head("https://x.test/avatars/a")).resolves.toBeNull();
    blobHead.mockRejectedValueOnce(new BlobServiceRateLimited());
    await expect(store.head("https://x.test/avatars/a")).rejects.toBeInstanceOf(
      BlobServiceRateLimited,
    );
  });
});
