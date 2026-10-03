import { describe, expect, it } from "vitest";
import { checkInstagramInput, parseInstagramInput } from "./instagram";

describe("parseInstagramInput", () => {
  it.each([
    ["john", "john"],
    ["@john", "john"],
    ["  @John.Doe_1  ", "john.doe_1"],
    ["instagram.com/john", "john"],
    ["www.instagram.com/john/", "john"],
    ["https://instagram.com/john?igsh=abc", "john"],
    ["https://www.instagram.com/john/#x", "john"],
    ["m.instagram.com/john", "john"],
    ["instagr.am/john", "john"],
    ["instagram.com/@john", "john"],
  ])("%s → %s", (raw, username) => {
    expect(parseInstagramInput(raw)).toBe(username);
  });

  it.each([
    "",
    "   ",
    "@",
    "https://",
    "instagram.com",
    "instagram.com/",
    "tiktok.com/@john",
    "https://example.com/john",
    "https://instagram.com.evil.io/john",
    "instagram.com/p/Cxyz/",
    "instagram.com/reel/Cxyz",
    "instagram.com/stories/john/123",
    "john doe",
    "a..b",
    ".john",
    "john.",
    "a".repeat(31),
  ])("отклоняет %j", (raw) => {
    expect(parseInstagramInput(raw)).toBeNull();
  });
});

describe("checkInstagramInput", () => {
  it.each([
    ["", "incomplete"],
    ["instagram.com/", "incomplete"],
    ["https://", "incomplete"],
    ["tiktok.com/@john", "not_instagram"],
    ["https://example.com", "not_instagram"],
    ["instagram.com/p/Cxyz/", "not_profile"],
    ["instagram.com/reels/Cxyz/", "not_profile"],
    ["john doe", "bad_username"],
    ["a..b", "bad_username"],
  ])("%j → %s", (raw, issue) => {
    expect(checkInstagramInput(raw)).toEqual({ ok: false, issue });
  });
});
