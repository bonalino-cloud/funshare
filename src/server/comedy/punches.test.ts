import { describe, expect, it } from "vitest";
import { hasLongDash } from "../roast/filters";
import { hasSpacedHyphen } from "./punches";

describe("hasSpacedHyphen: дефис с пробелами вместо тире, только comedy", () => {
  it.each([
    ["Ты продаёшь дисциплину - видно, зеркало", true],
    ["Шейкер у тебя в кадре, - вывод", true],
    ["Шейкер «бицепс» - охуенно", true],
    ["От 5 - 7 шейкеров в кадре", false],
    ["Подход 3 - зеркало", false],
    ["Зеркало - 30 дней", false],
    ["Как-то по-русски, без пробелов", false],
    ["- Реплика в начале строки", false],
  ])("%s → %s", (text, expected) => {
    expect(hasSpacedHyphen(text)).toBe(expected);
  });

  it("общий слой 4 не меняется: обычный дефис с пробелами там не тире", () => {
    expect(hasLongDash("Ты продаёшь дисциплину - видно, зеркало")).toBe(false);
  });
});
