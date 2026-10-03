import { describe, expect, it } from "vitest";
import { parseServerEnv, redisCredentials } from "./env";

describe("parseServerEnv", () => {
  it("принимает пустое окружение", () => {
    expect(parseServerEnv({})).toEqual({});
  });

  it("считает пустую строку незаданной", () => {
    expect(parseServerEnv({ DATABASE_URL: "" })).toEqual({});
  });

  it("отклоняет невалидный URL", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "not-a-url" })).toThrow();
  });
});

describe("redisCredentials", () => {
  const url = "https://example.upstash.io";

  it("берёт пару UPSTASH_REDIS_REST_*", () => {
    const env = parseServerEnv({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: "t1" });
    expect(redisCredentials(env)).toEqual({ url, token: "t1" });
  });

  it("берёт пару KV_REST_API_* из Vercel Marketplace", () => {
    const env = parseServerEnv({ KV_REST_API_URL: url, KV_REST_API_TOKEN: "t2" });
    expect(redisCredentials(env)).toEqual({ url, token: "t2" });
  });

  it("при обеих парах приоритет у UPSTASH_REDIS_REST_*", () => {
    const env = parseServerEnv({
      UPSTASH_REDIS_REST_URL: url,
      UPSTASH_REDIS_REST_TOKEN: "t1",
      KV_REST_API_URL: "https://other.upstash.io",
      KV_REST_API_TOKEN: "t2",
    });
    expect(redisCredentials(env)).toEqual({ url, token: "t1" });
  });

  it("половина пары — не доступ", () => {
    expect(redisCredentials(parseServerEnv({ KV_REST_API_URL: url }))).toBeNull();
    expect(redisCredentials(parseServerEnv({}))).toBeNull();
  });
});
