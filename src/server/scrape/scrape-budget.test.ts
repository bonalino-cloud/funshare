import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CostMeter } from "../cost";
import { ScrapeTransportError } from "./apify";
import openProfile from "./fixtures/open-profile.json";
import { scrapeProfile } from "./scrape-profile";
import { makeDeps } from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const lease = () => ({ settle: vi.fn<(results: number) => Promise<void>>(async () => {}) });

it("резерв перед Apify, settle с числом результатов", async () => {
  const { deps } = makeDeps({ fetchRaw: vi.fn(async () => openProfile) });
  const l = lease();
  const reserve = vi.fn(async () => l);
  const result = await scrapeProfile("test.user", { ...deps, budget: { reserve } });
  expect(result.ok).toBe(true);
  expect(reserve).toHaveBeenCalledOnce();
  expect(l.settle).toHaveBeenCalledExactlyOnceWith(openProfile.length);
});

it("потолок исчерпан: rate_limited, Apify не зовётся, счётчик трат пуст", async () => {
  const { deps } = makeDeps();
  const meter = new CostMeter();
  const reserve = vi.fn(async () => null);
  const result = await scrapeProfile("test.user", { ...deps, meter, budget: { reserve } });
  expect(result).toEqual({ ok: false, errorCode: "rate_limited" });
  expect(deps.fetchRaw).not.toHaveBeenCalled();
  expect(reserve).toHaveBeenCalledOnce();
  expect(meter.snapshot().apify).toBeNull();
  expect(deps.putRaw).not.toHaveBeenCalled();
});

it("ретрай тоже резервирует; отказ на ретрае останавливает без вызова", async () => {
  const { deps } = makeDeps({
    fetchRaw: vi.fn(async () => {
      throw new ScrapeTransportError("5xx", true);
    }),
  });
  const reserve = vi.fn().mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
  const result = await scrapeProfile("test.user", { ...deps, budget: { reserve } });
  expect(result).toEqual({ ok: false, errorCode: "rate_limited" });
  expect(deps.fetchRaw).toHaveBeenCalledOnce();
  expect(reserve).toHaveBeenCalledTimes(2);
});

it("транспортная ошибка: резерв остаётся (settle не зовётся)", async () => {
  const { deps } = makeDeps({
    fetchRaw: vi.fn(async () => {
      throw new ScrapeTransportError("401", false);
    }),
  });
  const l = lease();
  const result = await scrapeProfile("test.user", { ...deps, budget: { reserve: async () => l } });
  expect(result).toEqual({ ok: false, errorCode: "internal" });
  expect(l.settle).not.toHaveBeenCalled();
});

it("счётчик недоступен (reserve бросает): internal, Apify не зовётся", async () => {
  const { deps } = makeDeps();
  const reserve = vi.fn(async () => {
    throw new Error("redis down");
  });
  const result = await scrapeProfile("test.user", { ...deps, budget: { reserve } });
  expect(result).toEqual({ ok: false, errorCode: "internal" });
  expect(deps.fetchRaw).not.toHaveBeenCalled();
});

it("кэш снимка при исчерпанном бюджете: отдаётся, бюджет не трогаем", async () => {
  const first = makeDeps({ fetchRaw: vi.fn(async () => openProfile) });
  await scrapeProfile("test.user", first.deps);
  const { deps } = makeDeps();
  deps.snapshots.findFresh.mockResolvedValue({
    id: "snap-cached",
    data: first.stored[0]?.data,
  } as never);
  const reserve = vi.fn(async () => null);
  const result = await scrapeProfile("test.user", { ...deps, budget: { reserve } });
  expect(result.ok).toBe(true);
  expect(reserve).not.toHaveBeenCalled();
  expect(deps.fetchRaw).not.toHaveBeenCalled();
});
