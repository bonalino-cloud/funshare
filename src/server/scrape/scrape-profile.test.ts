import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSnapshot } from "@/contracts";
import { ScrapeTransportError } from "./apify";
import emptyDataset from "./fixtures/empty-dataset.json";
import fewPosts from "./fixtures/few-posts.json";
import malformed from "./fixtures/malformed-schema.json";
import noText from "./fixtures/no-text.json";
import notFound from "./fixtures/not-found.json";
import openProfile from "./fixtures/open-profile.json";
import privateProfile from "./fixtures/private-profile.json";
import { CACHE_TTL_MS, normalizeUsername, scrapeProfile } from "./scrape-profile";
import { makeDeps, NOW } from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("normalizeUsername", () => {
  it("trim, @, lowercase", () => {
    expect(normalizeUsername("  @Test.User_1 ")).toBe("test.user_1");
  });
  it.each([
    "",
    "a/b",
    "../etc",
    "a b",
    "ник",
    "x".repeat(31),
    "a?b=c",
    "a\nb",
    "%2e%2e",
    ".",
    "..",
    "a..b",
    ".a",
    "a.",
  ])("отклоняет %j", (bad) => expect(normalizeUsername(bad)).toBeNull());
});

describe("scrapeProfile: успех", () => {
  it("кэш-промах: Apify → Blob → БД, cached=false", async () => {
    const { deps } = makeDeps({ fetchRaw: vi.fn(async () => openProfile) });
    const order: string[] = [];
    deps.putRaw.mockImplementation(async () => void order.push("blob"));
    deps.snapshots.insert.mockImplementation(async () => {
      order.push("db");
      return "snap-order";
    });

    const result = await scrapeProfile("@Test.User", deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cached).toBe(false);
    expect(result.snapshotId).toBe("snap-order");
    expect(result.snapshot.posts).toHaveLength(24);
    expect(deps.fetchRaw).toHaveBeenCalledExactlyOnceWith("test.user");
    expect(order).toEqual(["blob", "db"]);
    const [key, json] = deps.putRaw.mock.calls[0] ?? [];
    expect(key).toBe("raw/test.user/2026-10-03T12-00-00-000Z.json");
    expect(JSON.parse(json ?? "")).toEqual(openProfile);
  });

  it("в БД уходит валидный снимок с тем же ключом Blob", async () => {
    const { deps, stored } = makeDeps({ fetchRaw: vi.fn(async () => openProfile) });
    await scrapeProfile("test.user", deps);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      igUsername: "test.user",
      rawBlobKey: "raw/test.user/2026-10-03T12-00-00-000Z.json",
    });
    expect(ProfileSnapshot.safeParse(stored[0]?.data).success).toBe(true);
  });

  it("кэш-хит: без вызова Apify, Blob и записи в БД", async () => {
    const first = makeDeps({ fetchRaw: vi.fn(async () => openProfile) });
    await scrapeProfile("test.user", first.deps);

    const { deps } = makeDeps();
    deps.snapshots.findFresh.mockResolvedValue({
      id: "snap-cached",
      data: first.stored[0]?.data,
      fetchedAt: NOW,
    });
    const result = await scrapeProfile("test.user", deps);

    expect(result).toMatchObject({ ok: true, cached: true, snapshotId: "snap-cached" });
    expect(deps.fetchRaw).not.toHaveBeenCalled();
    expect(deps.putRaw).not.toHaveBeenCalled();
    expect(deps.snapshots.insert).not.toHaveBeenCalled();
    const since = deps.snapshots.findFresh.mock.calls[0]?.[1];
    expect(NOW.getTime() - (since?.getTime() ?? 0)).toBe(CACHE_TTL_MS);
  });

  it("битый снимок в кэше → как промах, перезапрос", async () => {
    const { deps } = makeDeps({ fetchRaw: vi.fn(async () => openProfile) });
    deps.snapshots.findFresh.mockResolvedValue({
      id: "snap-bad",
      data: { garbage: true },
      fetchedAt: NOW,
    });
    const result = await scrapeProfile("test.user", deps);
    expect(result).toMatchObject({ ok: true, cached: false });
    expect(deps.fetchRaw).toHaveBeenCalledTimes(1);
  });
});

describe("scrapeProfile: коды ошибок", () => {
  const run = async (raw: unknown) => {
    const { deps } = makeDeps({ fetchRaw: vi.fn(async () => raw) });
    const result = await scrapeProfile("someone", deps);
    return { result, deps };
  };

  it("пустой датасет → profile_not_found", async () => {
    expect((await run(emptyDataset)).result).toEqual({ ok: false, errorCode: "profile_not_found" });
  });

  it("элемент с error → profile_not_found", async () => {
    expect((await run(notFound)).result).toEqual({ ok: false, errorCode: "profile_not_found" });
  });

  it("закрытый → profile_private, ничего не пишем", async () => {
    const { result, deps } = await run(privateProfile);
    expect(result).toEqual({ ok: false, errorCode: "profile_private" });
    expect(deps.putRaw).not.toHaveBeenCalled();
    expect(deps.snapshots.insert).not.toHaveBeenCalled();
    expect(deps.fetchRaw).toHaveBeenCalledTimes(1);
  });

  it("меньше 6 постов → not_enough_data (снимок всё же кэшируется)", async () => {
    const { result, deps } = await run(fewPosts);
    expect(result).toEqual({ ok: false, errorCode: "not_enough_data" });
    expect(deps.snapshots.insert).toHaveBeenCalledTimes(1);
  });

  it("пустое био и пустые подписи → not_enough_data", async () => {
    expect((await run(noText)).result).toEqual({ ok: false, errorCode: "not_enough_data" });
  });

  it("not_enough_data из кэша не ходит в Apify", async () => {
    const first = await run(fewPosts);
    const { deps } = makeDeps();
    const data = first.deps.snapshots.insert.mock.calls[0]?.[0].data;
    deps.snapshots.findFresh.mockResolvedValue({ id: "snap-x", data, fetchedAt: NOW });
    expect(await scrapeProfile("someone", deps)).toEqual({
      ok: false,
      errorCode: "not_enough_data",
    });
    expect(deps.fetchRaw).not.toHaveBeenCalled();
  });

  it("наружу только errorCode, подробности провайдера не утекают", async () => {
    const { result } = await run(notFound);
    expect(JSON.stringify(result)).not.toContain("Page not found");
  });
});

describe("scrapeProfile: ретраи и ввод", () => {
  it("невалидный ник не вызывает ни fetch, ни кэш", async () => {
    const { deps } = makeDeps();
    expect(await scrapeProfile("../../etc/passwd", deps)).toEqual({
      ok: false,
      errorCode: "invalid_url",
    });
    expect(deps.fetchRaw).not.toHaveBeenCalled();
    expect(deps.snapshots.findFresh).not.toHaveBeenCalled();
  });

  it("битая схема: ровно один ретрай, затем internal", async () => {
    const { deps } = makeDeps({ fetchRaw: vi.fn(async () => malformed) });
    expect(await scrapeProfile("someone", deps)).toEqual({ ok: false, errorCode: "internal" });
    expect(deps.fetchRaw).toHaveBeenCalledTimes(2);
    expect(deps.putRaw).not.toHaveBeenCalled();
  });

  it("не массив вместо датасета: ретрай, затем internal", async () => {
    const { deps } = makeDeps({ fetchRaw: vi.fn(async () => ({ unexpected: true })) });
    expect(await scrapeProfile("someone", deps)).toEqual({ ok: false, errorCode: "internal" });
    expect(deps.fetchRaw).toHaveBeenCalledTimes(2);
  });

  it("сетевая ошибка, потом успех: ретрай спасает", async () => {
    const fetchRaw = vi
      .fn()
      .mockRejectedValueOnce(new ScrapeTransportError("5xx", true))
      .mockResolvedValueOnce(openProfile);
    const { deps } = makeDeps({ fetchRaw });
    expect(await scrapeProfile("test.user", deps)).toMatchObject({ ok: true, cached: false });
    expect(fetchRaw).toHaveBeenCalledTimes(2);
  });

  it("две сетевые ошибки подряд (таймаут): ровно 2 вызова, internal", async () => {
    const fetchRaw = vi.fn().mockRejectedValue(new ScrapeTransportError("таймаут", true));
    const { deps } = makeDeps({ fetchRaw });
    expect(await scrapeProfile("test.user", deps)).toEqual({ ok: false, errorCode: "internal" });
    expect(fetchRaw).toHaveBeenCalledTimes(2);
  });

  it("неретраибельная ошибка (авторизация): один вызов", async () => {
    const fetchRaw = vi
      .fn()
      .mockRejectedValue(new ScrapeTransportError("Apify ответил 401", false));
    const { deps } = makeDeps({ fetchRaw });
    expect(await scrapeProfile("test.user", deps)).toEqual({ ok: false, errorCode: "internal" });
    expect(fetchRaw).toHaveBeenCalledTimes(1);
  });
});

describe("scrapeProfile: сбои хранилищ и логи", () => {
  it("сбой Blob → internal, в БД не пишем", async () => {
    const { deps } = makeDeps({ fetchRaw: vi.fn(async () => openProfile) });
    deps.putRaw.mockRejectedValue(new Error("blob down"));
    expect(await scrapeProfile("test.user", deps)).toEqual({ ok: false, errorCode: "internal" });
    expect(deps.snapshots.insert).not.toHaveBeenCalled();
  });

  it("сбой БД при чтении кэша → internal, Apify не трогаем", async () => {
    const { deps } = makeDeps();
    deps.snapshots.findFresh.mockRejectedValue(new Error("db down"));
    expect(await scrapeProfile("test.user", deps)).toEqual({ ok: false, errorCode: "internal" });
    expect(deps.fetchRaw).not.toHaveBeenCalled();
  });

  it("в лог не попадает текст произвольной ошибки (токен, тело ответа)", async () => {
    const fetchRaw = vi.fn().mockRejectedValue(new Error("Bearer secret-token-123 leaked"));
    const { deps } = makeDeps({ fetchRaw });
    await scrapeProfile("test.user", deps);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("secret-token-123");
  });
});
