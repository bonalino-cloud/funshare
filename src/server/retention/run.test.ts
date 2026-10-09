import { describe, expect, it, vi } from "vitest";
import { BLOB_MAX_DELETED, DB_BATCH_SIZE, DB_MAX_BATCHES, RETENTION_MS } from "./config";
import {
  retentionCutoff,
  retentionLogLine,
  runRetention,
  type BlobObject,
  type RetentionBlobStore,
  type RetentionDb,
  type RetentionDeps,
} from "./run";

const NOW = new Date("2026-10-09T03:00:00.000Z");
const CUTOFF = new Date(NOW.getTime() - RETENTION_MS);

function fakeBlobStore(blobs: BlobObject[], pageSize = 1000) {
  const removed: string[] = [];
  const store: RetentionBlobStore = {
    list: vi.fn(async ({ prefix, cursor, limit }) => {
      const all = blobs.filter((b) => b.pathname.startsWith(prefix));
      const start = cursor ? Number(cursor) : 0;
      const size = Math.min(limit, pageSize);
      return {
        blobs: all.slice(start, start + size),
        cursor: String(start + size),
        hasMore: start + size < all.length,
      };
    }),
    head: vi.fn(async (url: string) => {
      const found = blobs.find((b) => b.url === url);
      return found ? { uploadedAt: found.uploadedAt } : null;
    }),
    del: vi.fn(async (urls: string[]) => {
      removed.push(...urls);
    }),
  };
  return { store, removed };
}

const blob = (pathname: string, uploadedAt: Date): BlobObject => ({
  url: `https://x.public.blob.vercel-storage.com/${pathname}`,
  pathname,
  uploadedAt,
});

function setup(over: Partial<RetentionDeps> = {}, dbOver: Partial<RetentionDb> = {}) {
  const db: RetentionDb = {
    deleteTraces: vi.fn(async () => 0),
    deleteSnapshots: vi.fn(async () => 0),
    clearAvatarUrls: vi.fn(async (urls: string[]) => urls.length),
    ...dbOver,
  };
  const raw = fakeBlobStore([]);
  const avatars = fakeBlobStore([]);
  const deps: RetentionDeps = {
    db,
    rawStore: () => raw.store,
    avatarStore: () => avatars.store,
    now: () => NOW,
    ...over,
  };
  return { deps, db, raw, avatars };
}

describe("граница срока", () => {
  it("cutoff = now - ровно 30 суток и передаётся в БД как есть", async () => {
    expect(retentionCutoff(NOW).toISOString()).toBe("2026-09-09T03:00:00.000Z");
    const t = setup();
    await runRetention(t.deps);
    expect(t.db.deleteTraces).toHaveBeenCalledWith(CUTOFF, DB_BATCH_SIZE);
    expect(t.db.deleteSnapshots).toHaveBeenCalledWith(CUTOFF, DB_BATCH_SIZE);
  });

  it("Blob: старше 30 дней удаляем, ровно 30 дней и свежее оставляем", async () => {
    const raw = fakeBlobStore([
      blob("raw/a/old.json", new Date(CUTOFF.getTime() - 1)),
      blob("raw/a/edge.json", CUTOFF),
      blob("raw/a/new.json", new Date(CUTOFF.getTime() + 1)),
    ]);
    const t = setup({ rawStore: () => raw.store });
    const result = await runRetention(t.deps);
    expect(raw.removed).toEqual(["https://x.public.blob.vercel-storage.com/raw/a/old.json"]);
    expect(result.raw).toEqual({ deleted: 1, truncated: false, error: null });
  });

  it("art/ и чужие префиксы не трогаем", async () => {
    const old = new Date(0);
    const raw = fakeBlobStore([blob("art/slug/1.webp", old), blob("other/x", old)]);
    const avatars = fakeBlobStore([blob("art/slug/1.webp", old)]);
    const t = setup({ rawStore: () => raw.store, avatarStore: () => avatars.store });
    await runRetention(t.deps);
    expect(raw.removed).toEqual([]);
    expect(avatars.removed).toEqual([]);
  });
});

describe("пачки и потолки", () => {
  it("БД: крутит пачки, пока пачка полная, и останавливается на неполной", async () => {
    const deleteTraces = vi
      .fn<RetentionDb["deleteTraces"]>()
      .mockResolvedValueOnce(DB_BATCH_SIZE)
      .mockResolvedValueOnce(DB_BATCH_SIZE)
      .mockResolvedValueOnce(7);
    const t = setup({}, { deleteTraces });
    const result = await runRetention(t.deps);
    expect(deleteTraces).toHaveBeenCalledTimes(3);
    expect(result.traces).toEqual({
      deleted: DB_BATCH_SIZE * 2 + 7,
      truncated: false,
      error: null,
    });
  });

  it("БД: потолок пачек за прогон, остаток помечен truncated", async () => {
    const deleteSnapshots = vi.fn(async () => DB_BATCH_SIZE);
    const t = setup({}, { deleteSnapshots });
    const result = await runRetention(t.deps);
    expect(deleteSnapshots).toHaveBeenCalledTimes(DB_MAX_BATCHES);
    expect(result.snapshots.truncated).toBe(true);
    expect(result.snapshots.deleted).toBe(DB_MAX_BATCHES * DB_BATCH_SIZE);
  });

  it("Blob: потолок удалённых за прогон, остаток помечен truncated", async () => {
    const many = Array.from({ length: BLOB_MAX_DELETED + 300 }, (_, i) =>
      blob(`raw/u/${i}.json`, new Date(0)),
    );
    const raw = fakeBlobStore(many, 500);
    const t = setup({ rawStore: () => raw.store });
    const result = await runRetention(t.deps);
    expect(result.raw.deleted).toBe(BLOB_MAX_DELETED);
    expect(result.raw.truncated).toBe(true);
  });

  it("бюджет времени: после его исчерпания новые пачки не начинаем", async () => {
    let calls = 0;
    const t = setup(
      {
        // первый вызов — старт, дальше «прошло 10 минут»
        now: () => (calls++ === 0 ? NOW : new Date(NOW.getTime() + 600_000)),
      },
      { deleteTraces: vi.fn(async () => DB_BATCH_SIZE) },
    );
    const result = await runRetention(t.deps);
    expect(t.db.deleteTraces).not.toHaveBeenCalled();
    expect(result.traces.truncated).toBe(true);
  });

  it("бюджет кончился посреди пачки head: остальные файлы пачки не проверяем и не трогаем", async () => {
    let late = false;
    const old = new Date(CUTOFF.getTime() - 1);
    const avatars = fakeBlobStore([blob("avatars/a", old), blob("avatars/b", old)]);
    const head = avatars.store.head;
    avatars.store.head = vi.fn(async (url: string) => {
      late = true; // первый head «съел» весь бюджет
      return head(url);
    });
    const t = setup({
      avatarStore: () => avatars.store,
      now: () => (late ? new Date(NOW.getTime() + 600_000) : NOW),
    });
    const result = await runRetention(t.deps);
    expect(avatars.store.head).toHaveBeenCalledTimes(1);
    expect(avatars.removed).toEqual([blob("avatars/a", old).url]);
    expect(result.avatars.deleted).toBe(1);
    expect(result.avatars.truncated).toBe(true);
  });
});

describe("независимость шагов", () => {
  it("сбой трасс не мешает снимкам и Blob; число удалённого до сбоя сохраняется", async () => {
    const boom = Object.assign(new Error("secret nick leaked"), { name: "NeonDbError" });
    const deleteTraces = vi
      .fn<RetentionDb["deleteTraces"]>()
      .mockResolvedValueOnce(DB_BATCH_SIZE)
      .mockRejectedValueOnce(boom);
    const raw = fakeBlobStore([blob("raw/a/old.json", new Date(0))]);
    const t = setup(
      { rawStore: () => raw.store },
      { deleteTraces, deleteSnapshots: async () => 3 },
    );
    const result = await runRetention(t.deps);
    expect(result.traces).toEqual({
      deleted: DB_BATCH_SIZE,
      truncated: false,
      error: "NeonDbError",
    });
    expect(result.snapshots.deleted).toBe(3);
    expect(result.raw.deleted).toBe(1);
  });

  it("нет токена raw-хранилища: падает только raw, БД и аватары работают", async () => {
    const missing = Object.assign(new Error("x"), { name: "RawBlobTokenMissing" });
    const avatars = fakeBlobStore([blob("avatars/h1", new Date(0))]);
    const t = setup(
      {
        rawStore: () => {
          throw missing;
        },
        avatarStore: () => avatars.store,
      },
      { deleteTraces: async () => 2 },
    );
    const result = await runRetention(t.deps);
    expect(result.raw.error).toBe("RawBlobTokenMissing");
    expect(result.traces.deleted).toBe(2);
    expect(result.avatars.deleted).toBe(1);
  });

  it("сбой БД не отменяет чистку Blob", async () => {
    const raw = fakeBlobStore([blob("raw/a/old.json", new Date(0))]);
    const t = setup(
      { rawStore: () => raw.store },
      {
        deleteTraces: async () => {
          throw new Error("db down");
        },
        deleteSnapshots: async () => {
          throw new Error("db down");
        },
      },
    );
    const result = await runRetention(t.deps);
    expect(result.traces.error).toBe("Error");
    expect(result.snapshots.error).toBe("Error");
    expect(raw.removed).toHaveLength(1);
  });

  it("сбой list в Blob не бросает наружу, шаг помечен ошибкой", async () => {
    const raw = fakeBlobStore([]);
    raw.store.list = vi.fn(async () => {
      throw Object.assign(new Error("x"), { name: "BlobServiceNotAvailable" });
    });
    const t = setup({ rawStore: () => raw.store });
    const result = await runRetention(t.deps);
    expect(result.raw.error).toBe("BlobServiceNotAvailable");
  });
});

describe("аватары", () => {
  const OLD = new Date(CUTOFF.getTime() - 1000);

  it("обнуляет avatarUrl ровно у удаляемых URL, и только потом удаляет файл", async () => {
    const order: string[] = [];
    const avatars = fakeBlobStore([
      blob("avatars/old1", OLD),
      blob("avatars/fresh", new Date(CUTOFF.getTime() + 1000)),
    ]);
    avatars.store.del = vi.fn(async () => {
      order.push("del");
    });
    const clearAvatarUrls = vi.fn(async (urls: string[]) => {
      order.push("clear");
      return urls.length;
    });
    const t = setup({ avatarStore: () => avatars.store }, { clearAvatarUrls });
    const result = await runRetention(t.deps);
    expect(clearAvatarUrls).toHaveBeenCalledWith([
      "https://x.public.blob.vercel-storage.com/avatars/old1",
    ]);
    expect(order).toEqual(["clear", "del"]);
    expect(result.avatars).toEqual({ deleted: 1, truncated: false, error: null, cleared: 1 });
  });

  it("файл перезаписан после list (свежий head) — не трогаем ни файл, ни URL в БД", async () => {
    const avatars = fakeBlobStore([blob("avatars/old1", OLD)]);
    avatars.store.head = vi.fn(async () => ({ uploadedAt: NOW }));
    const t = setup({ avatarStore: () => avatars.store });
    const result = await runRetention(t.deps);
    expect(t.db.clearAvatarUrls).not.toHaveBeenCalled();
    expect(avatars.store.del).not.toHaveBeenCalled();
    expect(result.avatars.deleted).toBe(0);
  });

  it("сбой del после обнуления: URL уже обнулены, ошибка в итоге, следующий прогон доделает", async () => {
    const avatars = fakeBlobStore([blob("avatars/old1", OLD)]);
    avatars.store.del = vi.fn(async () => {
      throw Object.assign(new Error("x"), { name: "BlobServiceNotAvailable" });
    });
    const t = setup({ avatarStore: () => avatars.store });
    const result = await runRetention(t.deps);
    expect(t.db.clearAvatarUrls).toHaveBeenCalledTimes(1);
    expect(result.avatars.error).toBe("BlobServiceNotAvailable");
    expect(result.avatars.cleared).toBe(1);
    expect(result.avatars.deleted).toBe(0);
  });

  it("параллельный прогон: файл уже удалён (head = null) — пропускаем", async () => {
    const avatars = fakeBlobStore([blob("avatars/old1", OLD)]);
    avatars.store.head = vi.fn(async () => null);
    const t = setup({ avatarStore: () => avatars.store });
    const result = await runRetention(t.deps);
    expect(result.avatars.deleted).toBe(0);
    expect(result.avatars.error).toBeNull();
  });
});

describe("лог", () => {
  it("одна строка только с числами и именами ошибок", async () => {
    const result = await runRetention(
      setup(
        {
          rawStore: () => {
            throw Object.assign(new Error("anya.travels https://x/avatars/h BLOB_TOKEN"), {
              name: "RawBlobTokenMissing",
            });
          },
        },
        { deleteTraces: async () => 4 },
      ).deps,
    );
    const line = retentionLogLine(result);
    expect(line).toBe(
      "[retention] traces=4 snapshots=0 raw=0(RawBlobTokenMissing) avatars=0 avatarUrlsCleared=0",
    );
    expect(line).not.toMatch(/anya|https|TOKEN/);
  });

  it("имя ошибки с посторонними символами заменяется на Error", async () => {
    const t = setup(
      {},
      {
        deleteTraces: async () => {
          throw Object.assign(new Error("x"), { name: "anya.travels@mail" });
        },
      },
    );
    const result = await runRetention(t.deps);
    expect(retentionLogLine(result)).toContain("traces=0(Error)");
  });

  it("ошибка SDK без name: берём имя класса", async () => {
    class BlobServiceRateLimited extends Error {}
    const t = setup(
      {},
      {
        deleteTraces: async () => {
          throw new BlobServiceRateLimited("Vercel Blob: rate limited");
        },
      },
    );
    const result = await runRetention(t.deps);
    expect(retentionLogLine(result)).toContain("traces=0(BlobServiceRateLimited)");
  });
});
