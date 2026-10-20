import { PersonaProfile, type ProfileSnapshot } from "@/contracts";
import type { AnalyzeErrorCode, AnalyzeStepResult } from "../analyze";
import type { PersonaRepository } from "../analyze/repository";
import { ANALYZE_TIMEOUT_MS, MAX_ATTEMPTS, PROMPT_VERSION } from "../analyze";
import { COVER_TIMEOUT_MS } from "../analyze/cover-fetch";
import { MAX_DURATION_SECONDS } from "../profile-check/config";
import type { DossierRefusal, DossierRunRepository } from "./repository";

/** Замок «досье считается» старше этого считается брошенным: функцию убили, не дописав. */
export const DOSSIER_STALE_MS = (MAX_DURATION_SECONDS + 30) * 1000;
/** Худший случай одного расчёта: все попытки analyze до таймаута плюс скачивание обложек. */
export const DOSSIER_COMPUTE_MAX_MS = MAX_ATTEMPTS * ANALYZE_TIMEOUT_MS + COVER_TIMEOUT_MS;
/** Как часто смотрим, не закончил ли досье чужой вызов. */
export const DOSSIER_POLL_MS = 2_000;

export type DossierResult =
  { ok: true } | { ok: false; errorCode: AnalyzeErrorCode | "profile_not_found"; busy?: true };

export type DossierDeps = {
  personas: Pick<PersonaRepository, "find">;
  runs: DossierRunRepository;
  /** Загрузка снимка по id, когда вызывающий его не передал; `null` — снимка нет (Cron его убрал). */
  loadSnapshot: (snapshotId: string) => Promise<ProfileSnapshot | null>;
  /** Шаг `analyze` (кэш по снимку и версии промпта внутри, запись досье тоже). */
  analyze: (input: { snapshotId: string; snapshot: ProfileSnapshot }) => Promise<AnalyzeStepResult>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

function logFailure(event: string, detail?: unknown) {
  const name = detail instanceof Error ? detail.name : "";
  console.error(`[dossier] ${event}${name ? `: ${name}` : ""}`);
}

async function safely(event: string, task: () => Promise<void>) {
  try {
    await task();
  } catch (error) {
    logFailure(event, error);
  }
}

/**
 * Гарантирует досье снимка ровно с одним платным вызовом модели, кто бы ни спросил (фон после
 * «Нашли!» или старт генерации).
 *
 * Порядок: готовое досье → отказ из `dossier_runs` → замок. Замок взят — считаем сами (`analyze`
 * сам берёт кэш и пишет досье); замок у другого — `waitMs` ждём его конца (опрос), по истечении
 * `busy`. Другой вызов упал и снял замок — берём его и считаем сами (один раз). Упавший расчёт
 * замок снимает, отказ гардрейла (`minor_detected`, `not_enough_data`) записывает.
 * `waitMs = 0` — фоновый режим: замок занят, значит досье уже считают, молча выходим.
 * `computeWindowMs` — сколько от начала вызова ещё можно НАЧАТЬ расчёт: позже худший случай
 * (`DOSSIER_COMPUTE_MAX_MS`) не влезет в `maxDuration`, функцию убьют посреди платного вызова и
 * замок повиснет. Тогда замок отпускаем и отвечаем `busy`: повтор посчитает с начала.
 */
export async function ensureDossier(
  input: { snapshotId: string; snapshot?: ProfileSnapshot },
  deps: DossierDeps,
  waitMs: number,
  computeWindowMs?: number,
): Promise<DossierResult> {
  const { snapshotId } = input;
  const startedAt = deps.now().getTime();
  const giveUpAt = startedAt + waitMs;

  for (;;) {
    try {
      const row = await deps.personas.find(snapshotId, PROMPT_VERSION);
      if (row && PersonaProfile.safeParse(row.data).success) return { ok: true };

      const claim = await deps.runs.claim(
        snapshotId,
        PROMPT_VERSION,
        deps.now(),
        new Date(deps.now().getTime() - DOSSIER_STALE_MS),
      );
      if (claim.kind === "refused") return { ok: false, errorCode: claim.errorCode };
      if (claim.kind === "claimed") {
        if (computeWindowMs !== undefined && deps.now().getTime() - startedAt > computeWindowMs) {
          await safely("замок не снят", () => deps.runs.release(snapshotId, PROMPT_VERSION));
          return { ok: false, errorCode: "internal", busy: true };
        }
        return await compute(input, deps);
      }
    } catch (error) {
      logFailure("сбой хранилища", error);
      return { ok: false, errorCode: "internal" };
    }

    if (deps.now().getTime() >= giveUpAt) return { ok: false, errorCode: "internal", busy: true };
    await deps.sleep(DOSSIER_POLL_MS);
  }
}

/** Замок уже наш: считаем и снимаем/превращаем замок в отказ. */
async function compute(
  input: { snapshotId: string; snapshot?: ProfileSnapshot },
  deps: DossierDeps,
): Promise<DossierResult> {
  const { snapshotId } = input;
  let refused = false;
  try {
    const snapshot = input.snapshot ?? (await deps.loadSnapshot(snapshotId));
    if (!snapshot) return { ok: false, errorCode: "profile_not_found" };

    const result = await deps.analyze({ snapshotId, snapshot });
    if (result.ok) return { ok: true };
    if (result.errorCode !== "internal") {
      await deps.runs.refuse(snapshotId, PROMPT_VERSION, result.errorCode as DossierRefusal);
      refused = true;
    }
    return { ok: false, errorCode: result.errorCode };
  } catch (error) {
    logFailure("расчёт не выполнен", error);
    return { ok: false, errorCode: "internal" };
  } finally {
    if (!refused)
      await safely("замок не снят", () => deps.runs.release(snapshotId, PROMPT_VERSION));
  }
}
