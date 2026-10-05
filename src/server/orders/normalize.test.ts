import { describe, expect, it } from "vitest";
import { normalizePromoCode } from "./normalize";

describe("normalizePromoCode", () => {
  it.each([
    ["fun-7k3q-9xpa", "FUN7K3Q9XPA"],
    ["  FUN 7K3Q  9XPA ", "FUN7K3Q9XPA"],
    ["Fun_7K3Q.9XPA!", "FUN7K3Q9XPA"],
    ["FUN​7K3Q", "FUN7K3Q"], // невидимый пробел нулевой ширины
    ["ＦＵＮ７", "FUN7"], // полноширинные символы (NFKC)
  ])("%s -> %s", (input, expected) => {
    expect(normalizePromoCode(input)).toBe(expected);
  });

  it("кириллический и латинский вариант одного слова дают один код", () => {
    expect(normalizePromoCode("СЕАМ")).toBe(normalizePromoCode("CEAM"));
    expect(normalizePromoCode("Ёлка")).toBe(normalizePromoCode("Елка"));
    expect(normalizePromoCode("погнали100")).toBe(normalizePromoCode("ПОГНАЛИ-100"));
  });

  it("0 и O не склеиваются", () => {
    expect(normalizePromoCode("A0")).not.toBe(normalizePromoCode("AO"));
  });

  it("мусор без букв и цифр даёт пустую строку", () => {
    expect(normalizePromoCode(" - _ . ")).toBe("");
  });
});
