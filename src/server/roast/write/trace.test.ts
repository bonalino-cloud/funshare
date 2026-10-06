import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCandidates } from "./write-candidates";
import { WriteFailedError } from "./types";
import { MAX_TRACE_CANDIDATES, newEntry, TRACE_OUTCOMES, TraceRecorder, WriteTrace } from "./trace";
import {
  fakeJudge,
  fakeModerator,
  fakeWriter,
  inputBase,
  makePersona,
  makeWriteDeps,
} from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const input = () => inputBase({ tier: 2, persona: makePersona({}, 14) });

function droppedAtLayer4(trace: WriteTrace): number {
  return trace.candidates.filter((c) => c.outcome === "dropped_layer4").length;
}

describe("трасса шага write", () => {
  it("успех: проходит свою схему, версии и модели записаны, chosen = выдача", async () => {
    const r = await writeCandidates(input(), makeWriteDeps());
    const trace = WriteTrace.parse(r.trace);
    expect(trace.result).toBe("ok");
    expect(trace.failure).toBeNull();
    expect(trace.prompts).toEqual({
      writer: "roast/v2",
      judge: "roast/v2",
      moderator: "roast/moderator-v2",
    });
    expect(trace.models).toEqual({
      writer: "test-writer",
      judge: "test-judge",
      moderator: "test-moderator",
    });
    expect(trace.rounds.length).toBe(r.stats.rounds);
    expect(trace.rounds[0]?.hookIds.length).toBeGreaterThan(0);
    // Выданные: те же punchId, что в кандидатах, с оценками судьи, вердиктом и карточкой банка.
    const chosen = trace.candidates.filter((c) => c.outcome === "chosen");
    expect(chosen.map((c) => c.punchId).sort()).toEqual(r.candidates.map((c) => c.id).sort());
    for (const c of chosen) {
      expect(c.scores).not.toBeNull();
      expect(c.verdict).not.toBeNull();
      expect(c.text).not.toBeNull();
      expect(c.jokeCardId).toMatch(/^sk/);
    }
    // Счётчики и отчёт фильтров лежат как есть.
    expect(trace.filters).toEqual(r.stats.filters);
    expect(trace.stats.written).toBe(r.stats.written);
    expect(trace.candidates.length).toBe(r.stats.written + droppedAtLayer4(trace));
  });

  it("вырезанные: слой 4, судья и слой 5 с причиной, оценками и вердиктом", async () => {
    // Каждый слой вычёркивает по одному кандидату: хватает остальных, выдача не падает.
    let profane = false;
    const writer = fakeWriter((hookId, n) => {
      if (n === 1 && !profane) {
        profane = true;
        return `Закат ${hookId}, блядь, вариант`;
      }
      return `Закат ${hookId} вариант ${n}`;
    });
    let cold = false;
    const judge = fakeJudge(4, (_id, text) => {
      if (cold || !text.endsWith("вариант 2")) return {};
      cold = true;
      return { warmth: 0 };
    });
    let unsafe = false;
    const moderator = fakeModerator((_id, text) => {
      if (unsafe || !text.endsWith("вариант 3")) return {};
      unsafe = true;
      return { friendSafe: false };
    });
    const r = await writeCandidates(input(), makeWriteDeps({ writer, judge, moderator }));
    const trace = WriteTrace.parse(r.trace);

    const l4 = trace.candidates.filter((c) => c.outcome === "dropped_layer4");
    expect(l4.length).toBeGreaterThan(0);
    expect(l4.every((c) => c.reason === "profanity" && c.text?.includes("блядь"))).toBe(true);

    const byJudge = trace.candidates.filter((c) => c.outcome === "dropped_judge");
    expect(byJudge.length).toBeGreaterThan(0);
    expect(byJudge.every((c) => c.reason === "warmth" && c.scores?.warmth === 0)).toBe(true);

    const byMod = trace.candidates.filter((c) => c.outcome === "dropped_layer5");
    expect(byMod.length).toBeGreaterThan(0);
    expect(
      byMod.every((c) => c.reason === "not_friend_safe" && c.verdict?.friendSafe === false),
    ).toBe(true);
    // Количества в трассе совпадают со счётчиками шага.
    expect(l4.length).toBe(r.stats.filters.layer4.profanity);
    expect(byJudge.length).toBe(r.stats.droppedByJudge);
    expect(byMod.length).toBe(r.stats.droppedByModerator);
    for (const c of trace.candidates) expect(TRACE_OUTCOMES).toContain(c.outcome);
  });

  it("утечка промпта: кандидат есть, код причины есть, куска промпта в трассе нет", async () => {
    const writer = fakeWriter((hookId, n) =>
      n === 1 ? `Закат ${hookId} CNRY-ABC123 вариант` : `Закат ${hookId} вариант ${n}`,
    );
    const r = await writeCandidates(input(), makeWriteDeps({ writer, canaries: ["cnry-abc123"] }));
    const trace = WriteTrace.parse(r.trace);
    const leaked = trace.candidates.filter((c) => c.reason === "prompt_leak");
    expect(leaked.length).toBeGreaterThan(0);
    expect(leaked.every((c) => c.text === null && c.outcome === "dropped_layer4")).toBe(true);
    expect(JSON.stringify(trace)).not.toMatch(/cnry/i);
  });

  it("брак писателя: ответ не по схеме и чужой крючок попадают в трассу без падения", async () => {
    const writer = vi.fn(async (p: { user: string }) => {
      const block = /<hooks>([\s\S]*?)<\/hooks>/.exec(p.user)?.[1] ?? "";
      const ids = [...block.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]!);
      const alien = {
        mechanism: "hyperbole",
        skeleton: null,
        emoji: "🔥",
        text: "Чужой крючок",
        evidenceRef: "x",
      };
      return {
        hooks: [
          ...ids.map((hookId) => ({
            hookId,
            candidates: [1, 2, 3].map((n) => ({
              mechanism: "hyperbole",
              skeleton: null,
              emoji: "🌅",
              text: `Закат ${hookId} вариант ${n}`,
              evidenceRef: "post:0",
            })),
          })),
          { hookId: "выдуманный", candidates: [alien, { junk: true }] },
        ],
      };
    });
    const r = await writeCandidates(input(), makeWriteDeps({ writer }));
    const trace = WriteTrace.parse(r.trace);
    const unknown = trace.candidates.filter((c) => c.reason === "unknown_hook");
    expect(unknown.length).toBe(
      2 * trace.stats.rounds * Math.ceil(trace.rounds[0]!.hookIds.length / 5),
    );
    expect(unknown.some((c) => c.text === null && c.mechanism === null)).toBe(true);
    expect(unknown.some((c) => c.text === "Чужой крючок")).toBe(true);
  });

  it("утечка в браке писателя (чужой крючок): текст тоже не хранится", async () => {
    const writer = vi.fn(async (p: { user: string }) => {
      const block = /<hooks>([\s\S]*?)<\/hooks>/.exec(p.user)?.[1] ?? "";
      const ids = [...block.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]!);
      const cand = (text: string) => ({
        mechanism: "hyperbole",
        skeleton: null,
        emoji: "🌅",
        text,
        evidenceRef: "post:0",
      });
      return {
        hooks: [
          ...ids.map((hookId) => ({
            hookId,
            candidates: [1, 2, 3].map((n) => cand(`Закат ${hookId} вариант ${n}`)),
          })),
          { hookId: "выдуманный", candidates: [cand("Метка cnry-abc123 вот")] },
        ],
      };
    });
    const r = await writeCandidates(input(), makeWriteDeps({ writer, canaries: ["cnry-abc123"] }));
    const trace = WriteTrace.parse(r.trace);
    expect(trace.candidates.some((c) => c.reason === "unknown_hook")).toBe(true);
    expect(JSON.stringify(trace)).not.toMatch(/cnry/i);
  });

  it("слишком много записей: трасса обрезается, а не теряется", () => {
    const rec = new TraceRecorder({
      level: "rare",
      mode: "self",
      tier: 1,
      prompts: { writer: "w", judge: "j", moderator: "m" },
      models: { writer: "w", judge: "j", moderator: "m" },
    });
    for (let i = 0; i < MAX_TRACE_CANDIDATES + 5; i++) rec.add(newEntry({ round: 1, hookId: "h" }));
    const trace = rec.build({ result: "ok" });
    expect(trace?.candidates.length).toBe(MAX_TRACE_CANDIDATES);
    expect(trace?.omittedCandidates).toBe(5);
  });

  it("провал шага: ошибка несёт трассу failed с кодом, вырезанные видны", async () => {
    const judge = fakeJudge(0);
    const error = await writeCandidates(input(), makeWriteDeps({ judge })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteFailedError);
    const trace = WriteTrace.parse((error as WriteFailedError).trace);
    expect(trace.result).toBe("failed");
    expect(trace.failure).toBe("not_enough_candidates");
    expect(trace.candidates.length).toBeGreaterThan(0);
    expect(trace.candidates.every((c) => c.outcome === "dropped_judge")).toBe(true);
  });

  it("провал до первого запроса (нет крючков): трасса пустая, но валидная", async () => {
    const persona = makePersona({}, 0);
    const error = await writeCandidates(inputBase({ tier: 2, persona }), makeWriteDeps()).catch(
      (e: unknown) => e,
    );
    expect((error as WriteFailedError).reason).toBe("no_hooks");
    const trace = WriteTrace.parse((error as WriteFailedError).trace);
    expect(trace.candidates).toEqual([]);
  });

  it("схема трассы режет раздутое: текст длиннее лимита не проходит", async () => {
    const r = await writeCandidates(input(), makeWriteDeps());
    const trace = WriteTrace.parse(r.trace);
    const bad = { ...trace, candidates: [{ ...trace.candidates[0]!, text: "я".repeat(401) }] };
    expect(WriteTrace.safeParse(bad).success).toBe(false);
  });
});
