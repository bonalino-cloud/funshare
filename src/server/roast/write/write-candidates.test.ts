import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidatesResponse } from "@/contracts";
import { LlmSchemaError } from "../../analyze/llm";
import { assemble, writeCandidates } from "./write-candidates";
import { WriteFailedError } from "./types";
import {
  fakeJudge,
  fakeWriter,
  inputBase,
  makePersona,
  makeTrace,
  makeWriteDeps,
} from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof WriteFailedError ? e.reason : "other";
  }
  return "none";
};

describe("writeCandidates", () => {
  it("счастливый путь: Поджог, до 10, уникальные id, проходит контракт", async () => {
    const r = await writeCandidates(inputBase({ tier: 1 }), makeWriteDeps());
    expect(r.candidates.length).toBeGreaterThanOrEqual(6);
    expect(r.candidates.length).toBeLessThanOrEqual(10);
    const parsed = CandidatesResponse.safeParse({
      generationId: "g",
      selectCount: 6,
      candidates: r.candidates.map((c) => ({ id: c.id, emoji: c.emoji, text: c.text })),
    });
    expect(parsed.success).toBe(true);
    expect(r.promptVersion).toBe("roast/v1");
    expect(r.candidates[0]!.trace.promptVersion).toBe("roast/v1");
    expect(r.candidates[0]!.trace.writerModel).toBe("test-writer");
  });

  it("Кострище: до 20", async () => {
    const r = await writeCandidates(
      inputBase({ tier: 2, persona: makePersona({}, 14) }),
      makeWriteDeps(),
    );
    expect(r.candidates.length).toBeLessThanOrEqual(20);
    expect(r.candidates.length).toBeGreaterThan(10);
  });

  it("id наблюдения меняется чисткой промпта: ответ модели по видимому id не теряется", async () => {
    const base = makePersona({}, 8);
    const persona = makePersona({
      observations: base.observations!.map((o, i) => ({ ...o, id: `<o${i + 1}>` })),
    });
    const r = await writeCandidates(inputBase({ tier: 1, persona }), makeWriteDeps());
    expect(r.candidates.length).toBeGreaterThanOrEqual(6);
    expect(r.candidates.every((c) => c.trace.hookId.startsWith("<o"))).toBe(true);
  });

  it("jokeCardId в трассе, а не в публичных полях", async () => {
    const r = await writeCandidates(inputBase(), makeWriteDeps());
    expect(r.candidates.some((c) => c.trace.jokeCardId !== null)).toBe(true);
    for (const c of r.candidates)
      expect(Object.keys(c).sort()).toEqual(["emoji", "fromTrial", "id", "text", "trace"]);
  });

  it("судья режет по поведению и теплу; без оценки кандидат не выдаётся", async () => {
    const deps = makeWriteDeps({
      judge: fakeJudge(4, (id) =>
        id === "c1" ? { warmth: 1 } : id === "c2" ? { aboutBehavior: 2 } : {},
      ),
    });
    const r = await writeCandidates(inputBase({ tier: 2 }), deps);
    expect(r.stats.droppedByJudge).toBeGreaterThanOrEqual(2);

    const skipOne = makeWriteDeps({
      judge: vi.fn(async (p) => {
        const out = (await fakeJudge(4)(p)) as { scores: unknown[] };
        return { scores: out.scores.slice(1) };
      }),
    });
    const r2 = await writeCandidates(inputBase({ tier: 2 }), skipOne);
    expect(r2.stats.unscored).toBeGreaterThanOrEqual(1);
  });

  it("well_done: тепло 2 проходит, на medium нет", async () => {
    const judge = () => fakeJudge(4, () => ({ warmth: 2 }));
    await expect(
      writeCandidates(inputBase({ level: "medium" }), makeWriteDeps({ judge: judge() })),
    ).rejects.toThrow();
    const r = await writeCandidates(
      inputBase({ level: "well_done" }),
      makeWriteDeps({ judge: judge() }),
    );
    expect(r.candidates.length).toBeGreaterThanOrEqual(8);
  });

  it("брак писателя вычёркивается: не по-русски, длинные, повторы", async () => {
    const writer = fakeWriter((hookId, n) =>
      n === 1 ? "English only joke here" : n === 2 ? "я".repeat(150) : `Закат ${hookId}`,
    );
    const r = await writeCandidates(
      inputBase({ tier: 2, persona: makePersona({}, 14) }),
      makeWriteDeps({ writer }),
    );
    expect(r.stats.droppedInvalid).toBeGreaterThan(0);
    for (const c of r.candidates) expect(c.text.length).toBeLessThanOrEqual(140);
  });

  it("шутка с запретной темой вычёркивается кодом", async () => {
    const writer = fakeWriter((hookId, n) =>
      n === 1 ? `Опять про деньги ${hookId}` : `Закат ${hookId} вариант ${n}`,
    );
    const r = await writeCandidates(
      inputBase({ tier: 2, persona: makePersona({}, 14) }),
      makeWriteDeps({ writer }),
    );
    expect(r.candidates.some((c) => c.text.includes("деньги"))).toBe(false);
    expect(r.stats.droppedInvalid).toBeGreaterThan(0);
  });

  it("слабая выдача: второй раунд по другим крючкам спасает", async () => {
    const judge = fakeJudge(4, (_id, text) =>
      Number(/раунд (\d+)/.exec(text)?.[1]) <= 2 ? { aboutBehavior: 0 } : {},
    );
    const writer = fakeWriter();
    const r = await writeCandidates(
      inputBase({ persona: makePersona({}, 14) }),
      makeWriteDeps({ judge, writer }),
    );
    expect(r.stats.rounds).toBe(2);
    expect(writer).toHaveBeenCalledTimes(3);
    expect((writer.mock.calls[2]![0] as { user: string }).user).toContain("<already_written>");
  });

  it("всё слабое: not_enough_candidates", async () => {
    expect(await reason(writeCandidates(inputBase(), makeWriteDeps({ judge: fakeJudge(0) })))).toBe(
      "not_enough_candidates",
    );
  });

  it("нет подходящих крючков: no_hooks", async () => {
    expect(
      await reason(writeCandidates(inputBase({ persona: makePersona({}, 0) }), makeWriteDeps())),
    ).toBe("no_hooks");
  });

  it("ретрай: сбой вызова, потом успех; три сбоя дают llm_failed", async () => {
    const real = fakeWriter();
    let n = 0;
    const flaky = vi.fn(async (p) => {
      if (++n < 3) throw new LlmSchemaError("нужен JSON");
      return real(p);
    });
    const r = await writeCandidates(
      inputBase({ persona: makePersona({}, 4) }),
      makeWriteDeps({ writer: flaky }),
    );
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(flaky).toHaveBeenCalledTimes(3);
    expect((flaky.mock.calls[2]![0] as { user: string }).user).toContain("нужен JSON");

    const dead = vi.fn(async () => {
      throw new Error("сеть");
    });
    expect(
      await reason(
        writeCandidates(
          inputBase({ persona: makePersona({}, 4) }),
          makeWriteDeps({ writer: dead }),
        ),
      ),
    ).toBe("llm_failed");
    expect(dead).toHaveBeenCalledTimes(3);
  });

  it("кривой ответ судьи не принимается: llm_failed", async () => {
    const judge = vi.fn(async () => ({ nope: 1 }));
    expect(
      await reason(
        writeCandidates(inputBase({ persona: makePersona({}, 4) }), makeWriteDeps({ judge })),
      ),
    ).toBe("llm_failed");
    expect(judge).toHaveBeenCalledTimes(3);
  });

  it("перенос из Поджога: впереди, fromTrial, дубли текста не повторяются, id не пересекаются", async () => {
    const carried = [
      { id: "p_0001", emoji: "🔥", text: "Перенесённая шутка про закат", trace: makeTrace() },
      { id: "p_0002", emoji: "🔥", text: "Закат номер o1 раунд 1 вариант 1", trace: makeTrace() },
    ];
    const r = await writeCandidates(inputBase({ tier: 2, carried }), makeWriteDeps());
    expect(r.candidates.slice(0, 2).map((c) => c.fromTrial)).toEqual([true, true]);
    expect(r.candidates.slice(2).every((c) => !c.fromTrial)).toBe(true);
    const ids = r.candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const texts = r.candidates.map((c) => c.text.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("лог: только счётчики", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await writeCandidates(inputBase(), makeWriteDeps());
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("Закат");
  });
});

describe("пачки", () => {
  const promptOf = (c: unknown) => (c as { user: string }).user;

  it("писатель: не больше 5 крючков на вызов, все крючки покрыты", async () => {
    const writer = fakeWriter();
    await writeCandidates(
      inputBase({ tier: 2, level: "well_done", persona: makePersona({}, 14) }),
      makeWriteDeps({ writer }),
    );
    const first = writer.mock.calls.slice(0, 2).map((c) => {
      const block = /<hooks>([\s\S]*?)<\/hooks>/.exec(promptOf(c[0]))?.[1] ?? "";
      return [...block.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
    });
    expect(first).toHaveLength(2);
    for (const ids of first) expect(ids.length).toBeLessThanOrEqual(5);
    expect(new Set(first.flat()).size).toBe(10);
  });

  it("судья: не больше 12 кандидатов на вызов, id сквозные, вызовы параллельны", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const inner = fakeJudge(4);
    const judge = vi.fn(async (p) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return inner(p);
    });
    const r = await writeCandidates(
      inputBase({ tier: 2, level: "well_done", persona: makePersona({}, 14) }),
      makeWriteDeps({ judge }),
    );
    const sizes = judge.mock.calls.map((c) => [...promptOf(c[0]).matchAll(/^\[c\d+\] /gm)].length);
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    for (const n of sizes) expect(n).toBeLessThanOrEqual(12);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(r.candidates.length).toBeGreaterThan(10);
    expect(r.stats.unscored).toBe(0);
  });

  it("судья: чужой id в ответе пачки не перетирает оценку другой пачки", async () => {
    const inner = fakeJudge(4);
    const judge = vi.fn(async (p) => {
      const out = (await inner(p)) as { scores: { id: string }[] };
      if (!/^\[c13\] /m.test(promptOf(p))) return out;
      // Вторая пачка: c13 честно, остальные перенумерованы с c1 и с нулём «про поведение».
      return {
        scores: out.scores.map((s, i) => (i === 0 ? s : { ...s, id: `c${i}`, aboutBehavior: 0 })),
      };
    });
    const r = await writeCandidates(
      inputBase({ tier: 2, level: "well_done", persona: makePersona({}, 14) }),
      makeWriteDeps({ judge }),
    );
    expect(r.stats.droppedByJudge).toBe(0);
    expect(r.stats.unscored).toBe(11);
  });

  it("судья: сбой одной пачки после ретраев — её кандидаты без оценки, шаг жив", async () => {
    const inner = fakeJudge(4);
    const judge = vi.fn(async (p) => {
      if (/^\[c13\] /m.test(promptOf(p))) throw new LlmSchemaError("обрезан");
      return inner(p);
    });
    const r = await writeCandidates(
      inputBase({ tier: 2, level: "well_done", persona: makePersona({}, 14) }),
      makeWriteDeps({ judge }),
    );
    expect(r.stats.unscored).toBe(12);
    expect(r.candidates).toHaveLength(18);
    // Ретраи только у упавшей пачки: 3 попытки ей, по одной двум остальным.
    expect(judge).toHaveBeenCalledTimes(5);
  });

  it("писатель: сбой одной пачки — остальные крючки дают выдачу", async () => {
    const inner = fakeWriter();
    const writer = vi.fn(async (p) => {
      if (/^\[o1\]/m.test(promptOf(p))) throw new Error("сеть");
      return inner(p);
    });
    const r = await writeCandidates(
      inputBase({ tier: 2, level: "well_done", persona: makePersona({}, 14) }),
      makeWriteDeps({ writer }),
    );
    expect(r.stats.written).toBe(15);
    expect(r.candidates.every((c) => c.trace.hookId !== "o1")).toBe(true);

    const dead = vi.fn(async () => {
      throw new Error("сеть");
    });
    expect(
      await reason(
        writeCandidates(
          inputBase({ tier: 2, level: "well_done", persona: makePersona({}, 14) }),
          makeWriteDeps({ writer: dead }),
        ),
      ),
    ).toBe("llm_failed");
    expect(dead).toHaveBeenCalledTimes(6);
  });
});

describe("assemble", () => {
  const mk = (hookId: string, total: number, order: number) => ({
    hookId,
    order,
    total,
    scores: { recognizability: 0, surprise: 0, brevity: 0, aboutBehavior: 0, warmth: 0 },
    candidate: {
      hookId,
      mechanism: "hyperbole" as const,
      evidenceRef: "",
      jokeCardId: null,
      emoji: "🔥",
      text: `${hookId}${order}`,
    },
  });
  it("сначала лучший каждого крючка, потом остальные, срез по max", () => {
    const pool = [mk("a", 20, 1), mk("a", 19, 2), mk("a", 18, 3), mk("b", 10, 4), mk("c", 9, 5)];
    const out = assemble(pool, 3);
    expect(out.map((s) => s.hookId).sort()).toEqual(["a", "b", "c"]);
    expect(assemble(pool, 10)).toHaveLength(5);
  });
});
