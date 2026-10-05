import { describe, expect, it } from "vitest";
import { filterBank, pickStyles } from "./bank";
import { selectHooks } from "./hooks";
import { makeBank, makeCard, makePersona } from "./test-helpers";

describe("filterBank", () => {
  it("rare: только mild и две механики скелетов", () => {
    const bank = {
      skeletons: [
        makeCard({ id: "a", mechanism: "hyperbole" }),
        makeCard({ id: "b", mechanism: "faux_compliment" }),
        makeCard({ id: "c", mechanism: "understatement", heat: "medium" }),
      ],
      examples: [makeCard({ id: "e1" }), makeCard({ id: "e2", heat: "hard" })],
    };
    const out = filterBank("rare", bank);
    expect(out.skeletons.map((c) => c.id)).toEqual(["b"]);
    expect(out.examples.map((c) => c.id)).toEqual(["e1"]);
  });
  it("well_done: medium и hard", () => {
    const out = filterBank("well_done", {
      skeletons: [makeCard({ id: "a", heat: "mild" }), makeCard({ id: "b", heat: "hard" })],
      examples: [],
    });
    expect(out.skeletons.map((c) => c.id)).toEqual(["b"]);
  });
  it("низкий вес и пустой текст образца отсеиваются", () => {
    const out = filterBank("medium", {
      skeletons: [makeCard({ id: "a", score: -2 })],
      examples: [makeCard({ id: "e", text: null }), makeCard({ id: "f", score: -5 })],
    });
    expect(out.skeletons).toHaveLength(0);
    expect(out.examples).toHaveLength(0);
  });
});

describe("pickStyles", () => {
  const hooks = selectHooks(makePersona({}, 6), "medium", 1);
  it("до 2 скелетов с разными механиками и до 3 образцов на крючок", () => {
    const styles = pickStyles(hooks, "medium", makeBank());
    expect(styles).toHaveLength(hooks.length);
    for (const s of styles) {
      expect(s.skeletons.length).toBeLessThanOrEqual(2);
      expect(new Set(s.skeletons.map((c) => c.mechanism)).size).toBe(s.skeletons.length);
      expect(s.examples.length).toBeLessThanOrEqual(3);
      expect(s.skeletons.map((c) => c.ref)).toEqual(["s1", "s2"].slice(0, s.skeletons.length));
    }
  });
  it("механика не повторяется чаще необходимого: разброс использования <= 1", () => {
    const styles = pickStyles(hooks, "medium", makeBank());
    const counts = new Map<string, number>();
    for (const s of styles)
      for (const c of s.skeletons) counts.set(c.mechanism, (counts.get(c.mechanism) ?? 0) + 1);
    const v = [...counts.values()];
    expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(1);
  });
  it("детерминирован", () => {
    expect(pickStyles(hooks, "medium", makeBank())).toEqual(
      pickStyles(hooks, "medium", makeBank()),
    );
  });
  it("пустой банк: крючки остаются без стиля", () => {
    const styles = pickStyles(hooks, "medium", { skeletons: [], examples: [] });
    expect(styles.every((s) => s.skeletons.length === 0 && s.examples.length === 0)).toBe(true);
  });
});
