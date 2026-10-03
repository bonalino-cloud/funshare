import { describe, expect, it, vi } from "vitest";
import { HashSaltMissingError, hashValue, isOwnerToken, newOwnerToken, sameHash } from "./hash";

describe("hash", () => {
  it("хэш стабилен, не содержит исходного значения и разводит назначения", () => {
    const ip = hashValue("ip", "203.0.113.7");
    expect(ip).toBe(hashValue("ip", "203.0.113.7"));
    expect(ip).not.toContain("203");
    expect(ip).not.toBe(hashValue("owner", "203.0.113.7"));
    expect(ip).toMatch(/^[0-9a-f]{64}$/);
  });

  it("production без HASH_SALT — отказ, а не публичная запасная соль", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HASH_SALT", "");
    try {
      expect(() => hashValue("ip", "203.0.113.7")).toThrow(HashSaltMissingError);
      vi.stubEnv("HASH_SALT", "s".repeat(32));
      expect(hashValue("ip", "203.0.113.7")).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sameHash сравнивает по значению", () => {
    expect(sameHash("abc", "abc")).toBe(true);
    expect(sameHash("abc", "abd")).toBe(false);
    expect(sameHash("abc", "abcd")).toBe(false);
  });

  it("токены уникальны и проходят проверку формата", () => {
    const a = newOwnerToken();
    expect(isOwnerToken(a)).toBe(true);
    expect(a).not.toBe(newOwnerToken());
    for (const bad of [undefined, "", "short", "a".repeat(44), `${"a".repeat(42)}!`]) {
      expect(isOwnerToken(bad)).toBe(false);
    }
  });
});
