import { describe, expect, it } from "vitest";
import type { Level } from "@/contracts";
import {
  type CardFlags,
  deriveFlags,
  exampleAllowances,
  JOKE_TOPICS,
  JokeLabel,
  usableAsExample,
  usableAsSkeleton,
} from "./card";

const label = (over: Partial<JokeLabel> = {}): JokeLabel => ({
  mechanism: "reversal",
  skeleton: "{Действие} звучит как {достижение}",
  slots: ["habit"],
  heat: "medium",
  topic: "behavior",
  redline: false,
  wellDoneOnly: false,
  nsfw: false,
  transferable: true,
  ...over,
});

describe("JokeLabel", () => {
  it("принимает корректную разметку", () => {
    expect(JokeLabel.safeParse(label()).success).toBe(true);
  });

  it.each([
    ["mechanism", { mechanism: "joke" }],
    ["skeleton многострочный", { skeleton: "a\nb" }],
    ["skeleton пустой", { skeleton: "  " }],
    ["skeleton длинный", { skeleton: "я".repeat(301) }],
    ["slot", { slots: ["pet"] }],
    ["heat", { heat: "spicy" }],
    ["флаг не boolean", { redline: "yes" }],
  ])("отклоняет: %s", (_name, over) => {
    expect(JokeLabel.safeParse({ ...label(), ...over }).success).toBe(false);
  });
});

describe("deriveFlags", () => {
  it.each(JOKE_TOPICS)("topic=%s: флаги выводятся кодом из темы", (topic) => {
    const out = deriveFlags(label({ topic }));
    expect(out.redline).toBe(topic === "health" || topic === "family");
    expect(out.wellDoneOnly).toBe(topic === "body" || topic === "sex");
  });

  it("модель не может снять флаг по теме, но может поставить свой (OR)", () => {
    expect(deriveFlags(label({ topic: "health", redline: false })).redline).toBe(true);
    expect(deriveFlags(label({ topic: "behavior", redline: true })).redline).toBe(true);
    expect(deriveFlags(label({ topic: "behavior", wellDoneOnly: true })).wellDoneOnly).toBe(true);
  });

  it("nsfw = 🔞 из md ИЛИ метка модели", () => {
    expect(deriveFlags(label({ nsfw: false }), true).nsfw).toBe(true);
    expect(deriveFlags(label({ nsfw: true }), false).nsfw).toBe(true);
    expect(deriveFlags(label({ nsfw: false }), false).nsfw).toBe(false);
  });

  it("не мутирует вход", () => {
    const input = label({ topic: "health" });
    deriveFlags(input);
    expect(input.redline).toBe(false);
  });
});

const LEVELS: Level[] = ["rare", "medium", "well_done"];
const bools = [false, true];

describe("usableAsExample / usableAsSkeleton: все комбинации", () => {
  for (const approved of bools) {
    for (const redline of bools) {
      for (const wellDoneOnly of bools) {
        for (const nsfw of bools) {
          const card: CardFlags = { approved, redline, wellDoneOnly, nsfw };
          for (const level of LEVELS) {
            const expected =
              approved && !redline && (level === "well_done" || (!wellDoneOnly && !nsfw));
            it(`${JSON.stringify(card)} @ ${level} → ${expected}`, () => {
              expect(usableAsExample(card, level)).toBe(expected);
            });
          }
          it(`skeleton ${JSON.stringify(card)} → approved`, () => {
            expect(usableAsSkeleton(card)).toBe(approved);
          });
        }
      }
    }
  }

  it("redline-карточка: скелет можно, пример нельзя ни на одном уровне", () => {
    const card: CardFlags = { approved: true, redline: true, wellDoneOnly: false, nsfw: false };
    expect(usableAsSkeleton(card)).toBe(true);
    expect(LEVELS.some((l) => usableAsExample(card, l))).toBe(false);
  });

  it("exampleAllowances: послабления только у well_done", () => {
    expect(exampleAllowances("rare")).toEqual({ wellDoneOnly: false, nsfw: false });
    expect(exampleAllowances("medium")).toEqual({ wellDoneOnly: false, nsfw: false });
    expect(exampleAllowances("well_done")).toEqual({ wellDoneOnly: true, nsfw: true });
  });
});
