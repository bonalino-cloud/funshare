import { describe, expect, it } from "vitest";
import { createDupIndex, normalizeText, textHash } from "./text";

describe("normalizeText", () => {
  it("регистр, ё→е, пунктуация и пробелы", () => {
    expect(normalizeText("  Ёжик,  ЕЖ!!! «Да»…  ")).toBe("ежик еж да");
  });
});

describe("textHash", () => {
  it("не зависит от регистра и пунктуации, зависит от 🔞", () => {
    expect(textHash("Привет, мир!", false)).toBe(textHash("привет мир", false));
    expect(textHash("привет мир", false)).not.toBe(textHash("привет мир", true));
    expect(textHash("привет мир", false)).toHaveLength(64);
  });
});

describe("createDupIndex", () => {
  const base = "ты снимаешь аэропорты чтобы хоть где-то был дом и там свет";

  it("точный дубль после нормализации", () => {
    const idx = createDupIndex();
    idx.add("a", base);
    expect(idx.find("Ты снимаешь аэропорты, ЧТОБЫ хоть где-то был дом и там свет!")).toBe("a");
  });

  it("близкое переписывание (Jaccard ≥ 0.8)", () => {
    const idx = createDupIndex();
    idx.add("a", base);
    expect(idx.find(base + " ну")).toBe("a");
  });

  it("разные шутки не склеиваются", () => {
    const idx = createDupIndex();
    idx.add("a", base);
    expect(idx.find("совсем другая мысль про кота и лампу в тёмной комнате")).toBeNull();
  });

  it("короткие тексты — только точное совпадение", () => {
    const idx = createDupIndex();
    idx.add("a", "один два три четыре");
    expect(idx.find("один два три четыре пять")).toBeNull();
    expect(idx.find("Один два три четыре")).toBe("a");
  });
});
