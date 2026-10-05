import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { richRu } from "../../facts/fixtures";
import { runWriteStep, type WriteStepDeps } from "./run";
import type { TrialPunchRow, WriteInputRow, WriteRepository } from "./repository";
import { WriteFailedError, type WrittenCandidate } from "./types";
import { WriteTrace } from "./trace";
import { makePersona, makeTrace, makeWriteDeps } from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function setup(over: Partial<WriteInputRow> | null = {}, trial: TrialPunchRow[] = []) {
  const saved: WrittenCandidate[] = [];
  const traces: { generationId: string; step: string; data: Record<string, unknown> }[] = [];
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
    saveTrace: vi.fn(async (generationId, step, data) => {
      traces.push({ generationId, step, data });
    }),
  };
  const writeDeps = makeWriteDeps();
  const deps: WriteStepDeps = { repo, write: () => writeDeps };
  return { repo, deps, saved, writeDeps, traces };
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

  it("трасса пишется после кандидатов: шаг write, версия, выбранные с punchId", async () => {
    const s = setup();
    await runWriteStep("g1", s.deps);
    expect(s.traces).toHaveLength(1);
    const trace = WriteTrace.parse(s.traces[0]?.data);
    expect(s.traces[0]).toMatchObject({ generationId: "g1", step: "write" });
    expect(trace.result).toBe("ok");
    expect(trace.prompts.moderator).toBe("roast/moderator-v1");
    const chosen = trace.candidates.filter((c) => c.outcome === "chosen").map((c) => c.punchId);
    expect(chosen.sort()).toEqual(s.saved.map((c) => c.id).sort());
  });

  it("падение записи трассы не роняет шаг: кандидаты сохранены, в лог только имя ошибки", async () => {
    const s = setup();
    class PgError extends Error {
      constructor() {
        super("секретный текст шутки и SQL");
        this.name = "PgError";
      }
    }
    s.repo.saveTrace = vi.fn(async () => {
      throw new PgError();
    });
    await expect(runWriteStep("g", s.deps)).resolves.toBeUndefined();
    expect(s.saved.length).toBeGreaterThan(0);
    const logged = vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .join(" | ");
    expect(logged).toContain("трасса не записана: PgError");
    expect(logged).not.toContain("секретный");
  });

  it("провал шага тоже оставляет трассу (для разбора), ошибка пробрасывается как есть", async () => {
    const s = setup();
    s.writeDeps.judge = vi.fn(async () => ({ scores: [] }));
    const thrown = await runWriteStep("g", s.deps).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(WriteFailedError);
    // Приватная трасса не уезжает дальше вместе с ошибкой.
    expect((thrown as WriteFailedError).trace).toBeNull();
    const failed = (thrown as WriteFailedError).reason;
    expect(failed).not.toBe("none");
    expect(s.traces).toHaveLength(1);
    const trace = WriteTrace.parse(s.traces[0]?.data);
    expect(trace.result).toBe("failed");
    expect(trace.failure).toBe(failed);
  });

  it("повтор шага не пишет трассу второй раз", async () => {
    const s = setup();
    await runWriteStep("g1", s.deps);
    await runWriteStep("g1", s.deps);
    expect(s.repo.saveTrace).toHaveBeenCalledTimes(1);
  });
});
