import { analyzeStep, defaultAnalyzeDeps } from "../analyze";
import { createPersonaRepository } from "../analyze/repository";
import { CostMeter, formatCostLog } from "../cost";
import { ProfileSnapshot } from "@/contracts";
import { createSnapshotRepository } from "../scrape/repository";
import { MAX_DURATION_SECONDS } from "../profile-check/config";
import { DOSSIER_COMPUTE_MAX_MS, ensureDossier, type DossierResult } from "./ensure";
import { createDossierRunRepository } from "./repository";

export { ensureDossier, DOSSIER_COMPUTE_MAX_MS, DOSSIER_STALE_MS, DOSSIER_POLL_MS } from "./ensure";
export type { DossierDeps, DossierResult } from "./ensure";

/** Старт генерации ждёт чужое досье до этого срока (меньше `maxDuration` маршрута генераций). */
export const GENERATION_DOSSIER_WAIT_MS = 200_000;
/**
 * Сам считать досье старт генерации начинает только в первые секунды вызова: худший расчёт
 * (3 попытки по 90 с + обложки) плюс запас должен уложиться в `maxDuration` маршрута (300 с).
 * Замок освободился позже (фон упал) — 503, повтор посчитает сразу.
 */
export const GENERATION_COMPUTE_WINDOW_MS =
  MAX_DURATION_SECONDS * 1000 - DOSSIER_COMPUTE_MAX_MS - 10_000;

/** Что вызывают фон проверки и старт генерации. Не бросает. */
export type EnsureDossier = (
  input: { snapshotId: string; snapshot?: ProfileSnapshot },
  waitMs: number,
  computeWindowMs?: number,
) => Promise<DossierResult>;

/**
 * Боевая сборка. Свой счётчик трат на каждый вызов: досье — отдельная строка `[cost] profile-dossier`,
 * не часть строки проверки. Строка пишется, только если модель реально вызывалась.
 */
export function defaultEnsureDossier(): EnsureDossier {
  const snapshots = createSnapshotRepository();
  const personas = createPersonaRepository();
  const runs = createDossierRunRepository();
  return async (input, waitMs, computeWindowMs) => {
    const meter = new CostMeter();
    try {
      return await ensureDossier(
        input,
        {
          personas,
          runs,
          loadSnapshot: async (id) => {
            const row = await snapshots.findById(id);
            const parsed = row ? ProfileSnapshot.safeParse(row.data) : null;
            return parsed?.success ? parsed.data : null;
          },
          analyze: (step) => analyzeStep(step, { ...defaultAnalyzeDeps(meter), personas }),
          now: () => new Date(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
        waitMs,
        computeWindowMs,
      );
    } finally {
      const cost = meter.snapshot();
      if (cost.apify || cost.llm.length > 0) console.error(formatCostLog("profile-dossier", cost));
    }
  };
}
