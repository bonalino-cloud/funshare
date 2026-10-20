import { describe, expect, it, vi } from "vitest";

// Ключи Redis — часть прод-состояния: смена префикса обнуляет и разводит живые счётчики.
const created = vi.hoisted(() => [] as { prefix: string; requests: number; window: string }[]);

vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow(requests: number, window: string) {
      return { requests, window };
    }
    constructor(opts: { prefix: string; limiter: { requests: number; window: string } }) {
      created.push({ prefix: opts.prefix, ...opts.limiter });
    }
  },
}));

const { createGenerationLimiter, createRateLimiter } = await import(".");
const env = { UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" };

describe("префиксы ключей Redis", () => {
  it("проверки профиля — прежние `rl:profile-check:*` и прежние числа", () => {
    created.length = 0;
    createRateLimiter(env, true);
    expect(created).toEqual([
      { prefix: "rl:profile-check:ip-hour", requests: 5, window: "1 h" },
      { prefix: "rl:profile-check:ip-day", requests: 30, window: "1 d" },
      { prefix: "rl:profile-check:owner-hour", requests: 5, window: "1 h" },
    ]);
  });

  it("старт генерации — отдельные `rl:generation:*`", () => {
    created.length = 0;
    createGenerationLimiter(env, true);
    expect(created).toEqual([
      { prefix: "rl:generation:ip-hour", requests: 10, window: "1 h" },
      { prefix: "rl:generation:ip-day", requests: 40, window: "1 d" },
      { prefix: "rl:generation:owner-hour", requests: 6, window: "1 h" },
    ]);
  });
});
