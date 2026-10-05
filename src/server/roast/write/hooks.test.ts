import { describe, expect, it } from "vitest";
import { classifyKind, eligibleHooks, hasNumber, overlapsForbidden, selectHooks } from "./hooks";
import { makePersona } from "./test-helpers";

describe("классификация и цифры", () => {
  it("тип по опоре", () => {
    expect(classifyKind(["fact:hashtag:закат=3"])).toBe("content");
    expect(classifyKind(["fact:postsPerWeek=4"])).toBe("rhythm");
    expect(classifyKind(["post:1"])).toBe("habit");
  });
  it("цифра в факте или в формулировке", () => {
    expect(hasNumber("без цифр", ["post:1"])).toBe(false);
    expect(hasNumber("40 сторис", ["post:1"])).toBe(true);
    expect(hasNumber("без цифр", ["fact:hashtag:закат=47"])).toBe(true);
  });
});

describe("запретные темы", () => {
  it("подстрока и основа слова", () => {
    expect(overlapsForbidden("Шутка про деньги", ["деньги"])).toBe(true);
    expect(overlapsForbidden("Тратит много денег", ["деньги"])).toBe(false);
    expect(overlapsForbidden("Болезнь бабушки", ["болезни близких"])).toBe(true);
    expect(overlapsForbidden("Закаты", ["деньги"])).toBe(false);
  });
  it("sensitiveEvents исключают крючок", () => {
    const persona = makePersona({ sensitiveEvents: ["развод родителей"] }, 3);
    persona.observations![0]!.claim = "Тема развода в подписях";
    const ids = eligibleHooks(persona).map((h) => h.id);
    expect(ids).not.toContain("o1");
  });
  it("небезопасные не идут в крючки", () => {
    const persona = makePersona({}, 3);
    persona.observations![0]!.safe = false;
    expect(eligibleHooks(persona).map((h) => h.id)).not.toContain("o1");
  });
});

describe("selectHooks", () => {
  it("сортировка по узнаваемости", () => {
    const hooks = eligibleHooks(makePersona({}, 6));
    for (let i = 1; i < hooks.length; i++) {
      expect(hooks[i - 1]!.recognizability).toBeGreaterThanOrEqual(hooks[i]!.recognizability);
    }
  });
  it("число крючков: по степени и тарифу", () => {
    const p = makePersona({}, 14);
    expect(selectHooks(p, "rare", 1)).toHaveLength(5);
    expect(selectHooks(p, "medium", 1)).toHaveLength(6);
    expect(selectHooks(p, "well_done", 1)).toHaveLength(8);
    expect(selectHooks(p, "rare", 2)).toHaveLength(10);
    expect(selectHooks(makePersona({}, 3), "medium", 2)).toHaveLength(3);
  });
  it("гарантирует крючок с цифрой, если он есть", () => {
    const p = makePersona({}, 10);
    for (const o of p.observations!) {
      o.evidence = ["post:1"];
      o.claim = `Закаты без цифр ${"я".repeat(Number(o.id.slice(1)))}`;
      o.recognizability = 5;
    }
    p.observations![9]!.claim = "47 закатов за месяц";
    p.observations![9]!.recognizability = 2;
    const ids = selectHooks(p, "rare", 1).map((h) => h.id);
    expect(ids).toContain("o10");
  });
  it("exclude убирает уже взятые", () => {
    const p = makePersona({}, 12);
    const first = selectHooks(p, "rare", 1).map((h) => h.id);
    const second = selectHooks(p, "rare", 1, new Set(first)).map((h) => h.id);
    expect(second.some((id) => first.includes(id))).toBe(false);
  });
  it("нет наблюдений: пусто", () => {
    expect(selectHooks(makePersona({ observations: undefined }), "medium", 1)).toEqual([]);
  });
});
