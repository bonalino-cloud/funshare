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

  it("одна общая основа («ланк») не режет: шутка про бизнес героя", () => {
    expect(hitsSensitiveEvent("Свой человек на Шри-Ланке, аренда ебучая", [lanka])).toBe(false);
    expect(hitsSensitiveEvent("Шри-Ланка, виллы, аренда: ты местный король", [lanka])).toBe(false);
  });

  it("повтор слова — одна основа, в тексте и в событии", () => {
    expect(hitsSensitiveEvent("Шри-Ланке, Шри-Ланке, Шри-Ланке: мантра", [lanka])).toBe(false);
    expect(hitsSensitiveEvent("Ты переехал опять", ["переезд, потом снова переезд"])).toBe(false);
  });

  it("составное имя через дефис — одна основа, а не две", () => {
    const spb = "переезд в Санкт-Петербург после развода";
    expect(hitsSensitiveEvent("Санкт-Петербург, третья кофейня за год", [spb])).toBe(false);
    expect(hitsSensitiveEvent("Санкт-Петербург и Петербург снова", [spb])).toBe(false);
    expect(hitsSensitiveEvent("Переехал в Петербург и сразу в зал", [spb])).toBe(true);
  });

  it("окончание коротких слов не мешает: Ланка/Ланку, Киев/Киева, мама/мамы", () => {
    expect(hitsSensitiveEvent("Шри-Ланку смыло бедствие, а ты сдаёшь виллы", [lanka])).toBe(true);
    expect(hitsSensitiveEvent("Киев, Крым и твой кофе", ["переезд из Киева после Крыма"])).toBe(
      true,
    );
    expect(hitsSensitiveEvent("Смерть, мама и протеин", ["смерть мамы"])).toBe(true);
    expect(hitsSensitiveEvent("Мама бы не одобрила твои траты", ["смерть мамы"])).toBe(false);
  });

  it("частые слова («году», «новая жизнь», «время») событие не опознают", () => {
    const loss = "потеря близкого человека в 2023 году";
    expect(hitsSensitiveEvent("С 2023 года ты качаешься", [loss])).toBe(false);
    expect(hitsSensitiveEvent("В 2023 ты потерял абонемент", [loss])).toBe(true);
    const divorce = "сложное время после развода, новая жизнь в Москве";
    expect(hitsSensitiveEvent("Время менять жизнь, а ты меняешь кроссовки", [divorce])).toBe(false);
    expect(hitsSensitiveEvent("Новая жизнь, старый абонемент", [divorce])).toBe(false);
    expect(hitsSensitiveEvent("После развода сразу в Москву", [divorce])).toBe(true);
  });

  it("регистр и ё не мешают", () => {
    expect(hitsSensitiveEvent("ПЕРЕЁХАЛ ИЗ ХАРЬКОВА И В ЗАЛ", [kharkiv])).toBe(true);
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
