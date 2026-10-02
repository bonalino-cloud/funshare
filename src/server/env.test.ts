import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

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
