import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileSnapshot } from "@/contracts";
import { analyzeStep, PROMPT_VERSION, type AnalyzeStepResult } from "../analyze";
import { makeProfile, makeStepDeps } from "../analyze/test-helpers";
import { maxDuration as generationsMaxDuration } from "@/app/api/generations/route";
import {
  DOSSIER_COMPUTE_MAX_MS,
  DOSSIER_POLL_MS,
  DOSSIER_STALE_MS,
  ensureDossier,
  type DossierDeps,
} from "./ensure";
import { GENERATION_COMPUTE_WINDOW_MS } from "./index";
import type { DossierClaim, DossierRunRepository } from "./repository";

const SNAP = "snap-1";
const snapshot: ProfileSnapshot = makeProfile();
let validPersona: unknown;

beforeAll(async () => {
  // Настоящее досье из настоящего analyzeStep на моках: не выдумываем форму руками.
  const t = makeStepDeps();
  const r = await analyzeStep({ snapshotId: "seed", snapshot }, t.deps);
  if (!r.ok) throw new Error("не удалось собрать досье для теста");
  validPersona = t.rows.get(`seed|${PROMPT_VERSION}`)?.data;
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

type Row = { status: "running" | "refused"; code?: string; at: number };

/** Те же правила, что в SQL: один замок на снимок, устаревший перехватывается, отказ липкий. */
function makeRuns(clock: { t: number }) {
  const rows = new Map<string, Row>();
  const repo = {
    claim: vi.fn<DossierRunRepository["claim"]>(async (id, _v, _now, staleBefore) => {
      const row = rows.get(id);
      if (!row || (row.status === "running" && row.at < staleBefore.getTime())) {
        rows.set(id, { status: "running", at: clock.t });
        return { kind: "claimed" } satisfies DossierClaim;
      }
      if (row.status === "running") return { kind: "running" } satisfies DossierClaim;
      return { kind: "refused", errorCode: row.code as "minor_detected" } satisfies DossierClaim;
    }),
    refuse: vi.fn<DossierRunRepository["refuse"]>(async (id, _v, code) => {
      rows.set(id, { status: "refused", code, at: clock.t });
    }),
    release: vi.fn<DossierRunRepository["release"]>(async (id) => {
      if (rows.get(id)?.status === "running") rows.delete(id);
    }),
  } satisfies DossierRunRepository;
  return { repo, rows };
}

function setup() {
  const clock = { t: 1_000_000 };
  const runs = makeRuns(clock);
  let persona: unknown = null;
  const analyze = vi.fn<DossierDeps["analyze"]>(async () => {
    persona = validPersona;
    return { ok: true } as AnalyzeStepResult;
  });
  const loadSnapshot = vi.fn<DossierDeps["loadSnapshot"]>(async () => snapshot);
  const sleep = vi.fn(async (ms: number) => {
    clock.t += ms;
  });
  const deps: DossierDeps = {
    personas: {
      find: vi.fn(async () =>
        persona ? { data: persona, model: "test", promptVersion: PROMPT_VERSION } : null,
      ),
    },
    runs: runs.repo,
    loadSnapshot,
    analyze,
    now: () => new Date(clock.t),
    sleep,
  };
  return {
    deps,
    runs,
    clock,
    analyze,
    loadSnapshot,
    sleep,
    setPersona: (p: unknown) => (persona = p),
  };
}

describe("ensureDossier", () => {
  it("готовое досье: ни замка, ни модели", async () => {
    const t = setup();
    t.setPersona(validPersona);
    expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 0)).toEqual({ ok: true });
    expect(t.runs.repo.claim).not.toHaveBeenCalled();
    expect(t.analyze).not.toHaveBeenCalled();
  });

  it("битое досье в БД считается отсутствующим", async () => {
    const t = setup();
    t.setPersona({ nope: 1 });
    expect(await ensureDossier({ snapshotId: SNAP, snapshot }, t.deps, 0)).toEqual({ ok: true });
    expect(t.analyze).toHaveBeenCalledOnce();
  });

  it("нет досье: замок, analyze по переданному снимку, замок снят", async () => {
    const t = setup();
    expect(await ensureDossier({ snapshotId: SNAP, snapshot }, t.deps, 0)).toEqual({ ok: true });
    expect(t.analyze).toHaveBeenCalledExactlyOnceWith({ snapshotId: SNAP, snapshot });
    expect(t.loadSnapshot).not.toHaveBeenCalled();
    expect(t.runs.rows.size).toBe(0);
  });

  it("снимок не передан (старт генерации): грузим по id", async () => {
    const t = setup();
    await ensureDossier({ snapshotId: SNAP }, t.deps, 0);
    expect(t.loadSnapshot).toHaveBeenCalledWith(SNAP);
    expect(t.analyze).toHaveBeenCalledOnce();
  });

  it("снимка нет: profile_not_found, модель не зовётся, замок снят", async () => {
    const t = setup();
    t.loadSnapshot.mockResolvedValue(null);
    expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 0)).toEqual({
      ok: false,
      errorCode: "profile_not_found",
    });
    expect(t.analyze).not.toHaveBeenCalled();
    expect(t.runs.rows.size).toBe(0);
  });

  it("отказ гардрейла записывается и липкий: повтор не зовёт модель", async () => {
    const t = setup();
    t.analyze.mockResolvedValue({ ok: false, errorCode: "minor_detected" });
    expect(await ensureDossier({ snapshotId: SNAP, snapshot }, t.deps, 0)).toEqual({
      ok: false,
      errorCode: "minor_detected",
    });
    expect(t.runs.repo.refuse).toHaveBeenCalledWith(SNAP, PROMPT_VERSION, "minor_detected");

    expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 5_000)).toEqual({
      ok: false,
      errorCode: "minor_detected",
    });
    expect(t.analyze).toHaveBeenCalledOnce();
  });

  it("сбой analyze (internal): замок снят, отказ не записан, повтор посчитает сам", async () => {
    const t = setup();
    t.analyze.mockResolvedValueOnce({ ok: false, errorCode: "internal" });
    expect(await ensureDossier({ snapshotId: SNAP, snapshot }, t.deps, 0)).toEqual({
      ok: false,
      errorCode: "internal",
    });
    expect(t.runs.repo.refuse).not.toHaveBeenCalled();
    expect(t.runs.rows.size).toBe(0);
    expect(await ensureDossier({ snapshotId: SNAP, snapshot }, t.deps, 0)).toEqual({ ok: true });
    expect(t.analyze).toHaveBeenCalledTimes(2);
  });

  it("analyze бросил: internal, замок снят, исключение не уходит наружу", async () => {
    const t = setup();
    t.analyze.mockRejectedValue(new Error("boom"));
    expect(await ensureDossier({ snapshotId: SNAP, snapshot }, t.deps, 0)).toEqual({
      ok: false,
      errorCode: "internal",
    });
    expect(t.runs.rows.size).toBe(0);
  });

  it("сбой хранилища при чтении: internal без исключения", async () => {
    const t = setup();
    t.deps.personas = {
      find: async () => {
        throw new Error("db");
      },
    };
    expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 0)).toEqual({
      ok: false,
      errorCode: "internal",
    });
  });

  describe("гонка: фон считает, а генерация стартует", () => {
    it("фон (waitMs = 0) при чужом замке выходит сразу и не платит второй раз", async () => {
      const t = setup();
      t.runs.rows.set(SNAP, { status: "running", at: t.clock.t });
      expect(await ensureDossier({ snapshotId: SNAP, snapshot }, t.deps, 0)).toEqual({
        ok: false,
        errorCode: "internal",
        busy: true,
      });
      expect(t.analyze).not.toHaveBeenCalled();
    });

    it("генерация ждёт: досье появилось в фоне, модель не зовётся", async () => {
      const t = setup();
      t.runs.rows.set(SNAP, { status: "running", at: t.clock.t });
      t.sleep.mockImplementation(async (ms: number) => {
        t.clock.t += ms;
        if (t.sleep.mock.calls.length === 3) {
          t.setPersona(validPersona);
          t.runs.rows.delete(SNAP);
        }
      });
      expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 60_000)).toEqual({ ok: true });
      expect(t.sleep).toHaveBeenCalledTimes(3);
      expect(t.analyze).not.toHaveBeenCalled();
    });

    it("генерация ждёт: фон закончил отказом minor, отказ без модели", async () => {
      const t = setup();
      t.runs.rows.set(SNAP, { status: "running", at: t.clock.t });
      t.sleep.mockImplementation(async (ms: number) => {
        t.clock.t += ms;
        t.runs.rows.set(SNAP, { status: "refused", code: "minor_detected", at: t.clock.t });
      });
      expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 60_000)).toEqual({
        ok: false,
        errorCode: "minor_detected",
      });
      expect(t.analyze).not.toHaveBeenCalled();
    });

    it("фон упал и снял замок: генерация считает сама, ровно один раз", async () => {
      const t = setup();
      t.runs.rows.set(SNAP, { status: "running", at: t.clock.t });
      t.sleep.mockImplementation(async (ms: number) => {
        t.clock.t += ms;
        t.runs.rows.delete(SNAP);
      });
      expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 60_000)).toEqual({ ok: true });
      expect(t.analyze).toHaveBeenCalledOnce();
    });

    it("срок ожидания вышел, замок свежий: busy, ничего не потрачено", async () => {
      const t = setup();
      t.runs.rows.set(SNAP, { status: "running", at: t.clock.t });
      expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 3 * DOSSIER_POLL_MS)).toEqual({
        ok: false,
        errorCode: "internal",
        busy: true,
      });
      expect(t.analyze).not.toHaveBeenCalled();
    });

    it("замок освободился поздно (вне computeWindowMs): не считаем, замок отпущен, busy", async () => {
      const t = setup();
      t.runs.rows.set(SNAP, { status: "running", at: t.clock.t });
      t.sleep.mockImplementation(async (ms: number) => {
        t.clock.t += ms;
        if (t.sleep.mock.calls.length === 10) t.runs.rows.delete(SNAP); // фон упал на 20-й секунде
      });
      expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 60_000, 15_000)).toEqual({
        ok: false,
        errorCode: "internal",
        busy: true,
      });
      expect(t.analyze).not.toHaveBeenCalled();
      expect(t.runs.rows.size).toBe(0); // повтор возьмёт замок сразу
    });

    it("замок свободен сразу: в окне computeWindowMs считаем сами", async () => {
      const t = setup();
      expect(await ensureDossier({ snapshotId: SNAP }, t.deps, 60_000, 15_000)).toEqual({
        ok: true,
      });
      expect(t.analyze).toHaveBeenCalledOnce();
    });

    it("окно старта генерации положительное и худший расчёт влезает в maxDuration", () => {
      expect(GENERATION_COMPUTE_WINDOW_MS).toBeGreaterThan(0);
      expect(GENERATION_COMPUTE_WINDOW_MS + DOSSIER_COMPUTE_MAX_MS).toBeLessThan(
        generationsMaxDuration * 1000,
      );
    });

    it("замок брошен (функцию убили): после DOSSIER_STALE_MS перехватываем и считаем", async () => {
      const t = setup();
      t.runs.rows.set(SNAP, { status: "running", at: t.clock.t - DOSSIER_STALE_MS - 1 });
      expect(await ensureDossier({ snapshotId: SNAP, snapshot }, t.deps, 0)).toEqual({ ok: true });
      expect(t.analyze).toHaveBeenCalledOnce();
    });

    it("два одновременных вызова: модель зовётся один раз", async () => {
      const t = setup();
      let finish: () => void = () => {};
      t.analyze.mockImplementation(async () => {
        await new Promise<void>((r) => (finish = r));
        t.setPersona(validPersona);
        return { ok: true } as AnalyzeStepResult;
      });
      const background = ensureDossier({ snapshotId: SNAP, snapshot }, t.deps, 0);
      await vi.waitFor(() => expect(t.analyze).toHaveBeenCalledOnce());
      t.sleep.mockImplementation(async (ms: number) => {
        t.clock.t += ms;
        await new Promise((r) => setTimeout(r, 5)); // реальная пауза: фон успевает закончить
      });
      const generation = ensureDossier({ snapshotId: SNAP }, t.deps, 600_000);
      await vi.waitFor(() => expect(t.sleep).toHaveBeenCalled());
      finish();
      expect(await background).toEqual({ ok: true });
      expect(await generation).toEqual({ ok: true });
      expect(t.analyze).toHaveBeenCalledOnce();
    });
  });
});
