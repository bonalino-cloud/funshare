import { describe, expect, it } from "vitest";
import { factsOverlap, parseSelection, topUpPicks } from "./insights";
import type { Insight } from "./schema";

const insight = (id: string, factIds: string[], potential = 3): Insight => ({
  id,
  category: id[0] as Insight["category"],
  title: `Инсайт ${id}`,
  factIds,
  insight: "механизм",
  directions: [],
  potential,
  risk: null,
});

const pick = (id: string) => ({ id, theme: "тема", mechanic: "гипербола", score: 8 });

describe("factsOverlap: пересечение не меньше половины меньшего набора", () => {
  it.each([
    [["F1", "F2"], ["F2", "F5"], true],
    [["F1"], ["F1", "F9"], true],
    [["F1", "F2", "F3", "F4"], ["F3", "F4", "F7"], true],
    [["F1", "F2", "F3"], ["F3", "F7", "F8"], false],
    [["F1", "F2"], ["F3", "F4"], false],
  ])("%j и %j → %s", (a, b, expected) => {
    expect(factsOverlap(a, b)).toBe(expected);
    expect(factsOverlap(b, a)).toBe(expected);
  });
});

describe("parseSelection", () => {
  const insights = [
    insight("A1", ["F1", "F2"]),
    insight("A2", ["F2", "F5"]),
    insight("B1", ["F1", "F2", "F3"]),
    insight("B2", ["F3", "F7", "F8"]),
    insight("C1", ["F9"]),
  ];

  it("вторая из двух с пересекающейся опорой выбывает, слабое пересечение остаётся", () => {
    const r = parseSelection({ picks: ["A1", "A2", "B2", "B1", "C1"].map(pick) }, insights);
    expect(r.ok && r.value.map((p) => p.id)).toEqual(["A1", "B2", "C1"]);
  });

  it("порядок модели решает, кто остаётся: первая выбранная", () => {
    const r = parseSelection({ picks: ["A2", "A1"].map(pick) }, insights);
    expect(r.ok && r.value.map((p) => p.id)).toEqual(["A2"]);
  });
});

describe("topUpPicks", () => {
  it("сначала без пересечения опоры, затем без точного повтора связки", () => {
    const insights = [
      insight("A1", ["F1", "F2"], 5),
      insight("A2", ["F2", "F5"], 5),
      insight("A3", ["F1", "F2"], 5),
      insight("B1", ["F7"], 1),
    ];
    const out = topUpPicks([pick("A1")], insights, 3).map((p) => p.id);
    // B1 без пересечения берётся первым, A2 (пересечение) — во втором проходе, A3 (повтор) — никогда.
    expect(out).toEqual(["A1", "B1", "A2"]);
    expect(topUpPicks([pick("A1")], insights, 10).map((p) => p.id)).not.toContain("A3");
  });
});
