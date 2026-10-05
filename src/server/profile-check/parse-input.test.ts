import { describe, expect, it } from "vitest";
import { parseInstagramInput } from "./parse-input";

describe("parseInstagramInput", () => {
  it.each([
    ["anya.travels", "anya.travels"],
    ["@Anya.Travels", "anya.travels"],
    ["  @anya_travels  ", "anya_travels"],
    ["https://www.instagram.com/anya.travels/", "anya.travels"],
    ["https://instagram.com/Anya.Travels?igsh=abc", "anya.travels"],
    ["http://m.instagram.com/anya.travels/reels/", "anya.travels"],
    ["instagram.com/anya.travels", "anya.travels"],
    ["www.instagram.com/anya.travels/#x", "anya.travels"],
    ["HTTPS://INSTAGRAM.COM/Anya.Travels", "anya.travels"],
  ])("%j → %j", (input, expected) => expect(parseInstagramInput(input)).toBe(expected));

  it.each([
    "",
    "   ",
    "@",
    "два слова",
    "ник",
    "a/b",
    "x".repeat(31),
    "https://instagram.com/",
    "https://instagram.com/p/Cabc123/",
    "https://instagram.com/reel/Cabc123/",
    "https://instagram.com/explore/tags/cats/",
    "https://instagram.com/stories/anya.travels/123/",
    "https://evil.com/anya.travels",
    "https://evil.com/instagram.com/anya.travels",
    "https://instagram.com.evil.com/anya.travels",
    "https://instagram.com@evil.com/anya.travels",
    "https://user:pass@instagram.com/anya.travels",
    "https://instagram.com:8080/anya.travels",
    "https://instagram.com/%2e%2e",
    "https://instagram.com/%E0%A4%A",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://",
  ])("отклоняет %j", (input) => expect(parseInstagramInput(input)).toBeNull());
});
