import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeLimiter,
  createRateLimiter,
  LIMITS,
  RateLimitUnavailableError,
  type Limit,
} from ".";

const limit = (success: boolean): Limit & { limit: ReturnType<typeof vi.fn> } => ({
  limit: vi.fn(async () => ({ success })),
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("лимиты по документу: 5 проверок в час на устройство и IP", () => {
  expect(LIMITS.ownerPerHour).toEqual({ requests: 5, window: "1 h" });
  expect(LIMITS.ipPerHour).toEqual({ requests: 5, window: "1 h" });
});

describe("composeLimiter", () => {
  it("пускает, когда все окна свободны", async () => {
    const limiter = composeLimiter({ ip: [limit(true), limit(true)], owner: [limit(true)] });
    expect(await limiter.check({ ipHash: "h", ownerHash: "o" })).toBe(true);
  });

  it("отказывает, если исчерпано любое окно, и при этом тратит остальные", async () => {
    const minute = limit(false);
    const day = limit(true);
    const owner = limit(true);
    const limiter = composeLimiter({ ip: [minute, day], owner: [owner] });
    expect(await limiter.check({ ipHash: "h", ownerHash: "o" })).toBe(false);
    expect(day.limit).toHaveBeenCalledWith("ip:h");
    expect(owner.limit).toHaveBeenCalledWith("owner:o");
  });

  it("лимит по ownerToken исчерпан → отказ", async () => {
    const limiter = composeLimiter({ ip: [limit(true)], owner: [limit(false)] });
    expect(await limiter.check({ ipHash: "h", ownerHash: "o" })).toBe(false);
  });

  it("без токена владельца считает только IP", async () => {
    const owner = limit(false);
    const limiter = composeLimiter({ ip: [limit(true)], owner: [owner] });
    expect(await limiter.check({ ipHash: "h", ownerHash: null })).toBe(true);
    expect(owner.limit).not.toHaveBeenCalled();
  });

  it("сбой Redis → RateLimitUnavailableError, а не «пускаем»", async () => {
    const broken: Limit = {
      limit: async () => {
        throw new Error("ECONNRESET");
      },
    };
    const limiter = composeLimiter({ ip: [broken], owner: [] });
    await expect(limiter.check({ ipHash: "h", ownerHash: null })).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });

  it("Redis молчит дольше таймаута → RateLimitUnavailableError", async () => {
    const hanging: Limit = { limit: () => new Promise(() => {}) };
    const limiter = composeLimiter({ ip: [hanging], owner: [] }, 10);
    await expect(limiter.check({ ipHash: "h", ownerHash: null })).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });
});

describe("createRateLimiter без Redis", () => {
  it("dev: пускает и предупреждает в лог", async () => {
    const limiter = createRateLimiter({}, false);
    expect(await limiter.check({ ipHash: "h", ownerHash: null })).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it("production: не открывает дыру — лимитер недоступен", async () => {
    const limiter = createRateLimiter({}, true);
    await expect(limiter.check({ ipHash: "h", ownerHash: null })).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });

  it("половина пары env — тоже «нет Redis»", async () => {
    const limiter = createRateLimiter({ KV_REST_API_URL: "https://x.upstash.io" }, true);
    await expect(limiter.check({ ipHash: "h", ownerHash: null })).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });
});
