import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { richRu } from "../../facts/fixtures";
import { runWriteStep, type WriteStepDeps } from "./run";
import type { TrialPunchRow, WriteInputRow, WriteRepository } from "./repository";
import { WriteFailedError, type WrittenCandidate } from "./types";
import { makePersona, makeTrace, makeWriteDeps } from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function setup(over: Partial<WriteInputRow> | null = {}, trial: TrialPunchRow[] = []) {
  const saved: WrittenCandidate[] = [];
  const repo: WriteRepository = {
    hasCandidates: vi.fn(async () => saved.length > 0),
    loadInput: vi.fn(async (): Promise<WriteInputRow | null> =>
      over === null
        ? null
        : {
            tier: 2,
            level: "medium",
            mode: "self",
            extraFacts: [],
            trialGenerationId: null,
            snapshot: richRu(),
            persona: makePersona({}, 14),
            ...over,
          },
    ),
    listSelected: vi.fn(async () => trial),
    saveCandidates: vi.fn(async (_id, candidates) => {
      saved.push(...candidates);
    }),
  };
  const writeDeps = makeWriteDeps();
  const deps: WriteStepDeps = { repo, write: () => writeDeps };
  return { repo, deps, saved, writeDeps };
}

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof WriteFailedError ? e.reason : "other";
  }
  return "none";
};

describe("runWriteStep", () => {
  it("пишет кандидатов, идемпотентен: повтор не зовёт модель", async () => {
    const { deps, repo, saved, writeDeps } = setup();
    await runWriteStep("g1", deps);
    expect(saved.length).toBeGreaterThan(0);
    const calls = vi.mocked(writeDeps.writer).mock.calls.length;
    await runWriteStep("g1", deps);
    expect(vi.mocked(writeDeps.writer).mock.calls.length).toBe(calls);
    expect(repo.saveCandidates).toHaveBeenCalledTimes(1);
  });

  it("нет входа: no_input", async () => {
    expect(await reason(runWriteStep("g", setup(null).deps))).toBe("no_input");
  });

  it("досье или снимок не по схеме: bad_input, модель не зовётся", async () => {
    const a = setup({ persona: { bad: true } });
    expect(await reason(runWriteStep("g", a.deps))).toBe("bad_input");
    expect(a.writeDeps.writer).not.toHaveBeenCalled();
    expect(await reason(runWriteStep("g", setup({ snapshot: {} }).deps))).toBe("bad_input");
  });

  it("флаги гардрейлов: bad_input", async () => {
    for (const flag of ["isPrivate", "likelyMinor", "insufficientData"] as const) {
      const persona = makePersona(
        { flags: { isPrivate: false, likelyMinor: false, insufficientData: false, [flag]: true } },
        14,
      );
      const s = setup({ persona });
      expect(await reason(runWriteStep("g", s.deps))).toBe("bad_input");
      expect(s.writeDeps.writer).not.toHaveBeenCalled();
    }
  });

  it("перенос из Поджога на Кострище: id сохраняются, fromTrial, битая запись пропускается", async () => {
    const trial: TrialPunchRow[] = [
      { punchId: "t1", emoji: "🔥", text: "Выбранная в Поджоге шутка", trace: makeTrace() },
      { punchId: "t2", emoji: "🔥", text: "Битая трасса", trace: { nope: 1 } },
      { punchId: "t3", emoji: "🔥", text: "я".repeat(200), trace: makeTrace() },
    ];
    const s = setup({ tier: 2, trialGenerationId: "trial" }, trial);
    await runWriteStep("g", s.deps);
    expect(s.saved[0]).toMatchObject({ id: "t1", fromTrial: true });
    expect(s.saved.filter((c) => c.fromTrial)).toHaveLength(1);
    expect(s.repo.listSelected).toHaveBeenCalledWith("trial");
  });

  it("перенос только для Кострища", async () => {
    const s = setup({ tier: 1, trialGenerationId: "trial" }, []);
    await runWriteStep("g", s.deps);
    expect(s.repo.listSelected).not.toHaveBeenCalled();
  });

  it("провал генерации пробрасывается и ничего не пишет", async () => {
    const s = setup();
    s.writeDeps.writer = vi.fn(async () => {
      throw new Error("x");
    });
    expect(await reason(runWriteStep("g", s.deps))).toBe("llm_failed");
    expect(s.repo.saveCandidates).not.toHaveBeenCalled();
  });
});
