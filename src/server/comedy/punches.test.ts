import { describe, expect, it } from "vitest";
import { hasLongDash } from "../roast/filters";
import { hasSpacedHyphen, hitsSensitiveEvent } from "./punches";

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

describe("hitsSensitiveEvent: две разные основы одного тяжёлого события", () => {
  const lanka = "стихийное бедствие на Шри-Ланке и сбор помощи острову";
  const kharkiv = "переезд из Харькова из-за войны";

  it("одна общая основа («ланке») не режет: шутка про бизнес героя", () => {
    expect(hitsSensitiveEvent("Свой человек на Шри-Ланке, аренда ебучая", [lanka])).toBe(false);
  });

  it("две основы одного события режут", () => {
    expect(hitsSensitiveEvent("После бедствия на Шри-Ланке ты сдаёшь виллы", [lanka])).toBe(true);
    expect(hitsSensitiveEvent("Ты переехал из Харькова и сразу в спортзал", [kharkiv])).toBe(true);
  });

  it("основы разных событий не складываются; стоп-слова и короткие слова не считаются", () => {
    expect(hitsSensitiveEvent("Харьков и бедствие в одной ленте", [lanka, kharkiv])).toBe(false);
    expect(hitsSensitiveEvent("Из-за тебя на острове", ["из-за войны на острове"])).toBe(false);
    expect(hitsSensitiveEvent("Любая шутка", [])).toBe(false);
  });
});
