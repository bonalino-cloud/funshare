import {
  CandidatesResponse,
  PersonaProfile,
  ProfileSnapshot,
  PunchCandidate,
  type Tier,
} from "@/contracts";
import { forbiddenTopics } from "../../analyze/forbidden";
import {
  ComedyFailedError,
  COMEDY_TRACE_STEP,
  defaultComedyDeps,
  isComedyLevel,
  writeComedyCandidates,
  type ComedyDeps,
  type ComedyInput,
} from "../../comedy";
import {
  createGenerationCostRepository,
  formatCostLog,
  type CostMeter,
  type GenerationCostRepository,
} from "../../cost";
import { buildProfileFacts } from "../../facts";
import { TIERS } from "../../pricing/config";
import { PunchTraceSchema } from "./schema";
import { createWriteRepository, type WriteRepository } from "./repository";
import { WRITE_TRACE_STEP } from "./trace";
import { WriteFailedError, type CarriedPunch, type WriteInput } from "./types";
import {
  defaultWriteDeps,
  writeCandidates,
  type WriteDeps,
  type WriteResult,
} from "./write-candidates";

export type WriteStepDeps = {
  repo: WriteRepository;
  write: () => WriteDeps;
  /** Запись трат шага в `generations`. */
  costs: GenerationCostRepository;
  /**
   * Comedy-движок для степеней из `COMEDY_LEVELS` (comedy-engine §8). Нет — боевые зависимости
   * (`defaultComedyDeps`); тесты подменяют фейками.
   */
  comedy?: () => ComedyDeps;
};

/** Боевые зависимости. Лениво на каждый вызов шага: сборка и тесты не требуют БД и ключа. */
export function defaultWriteStepDeps(): WriteStepDeps {
  return {
    repo: createWriteRepository(),
    write: defaultWriteDeps,
    costs: createGenerationCostRepository(),
    comedy: defaultComedyDeps,
  };
}

function logFailure(event: string) {
  console.error(`[write] ${event}`);
}

/**
 * Трасса в `generation_traces`. Её потеря не должна ронять генерацию: в лог только имя ошибки
 * (ни текстов, ни SQL с данными).
 */
async function saveTraceSafe(
  repo: WriteRepository,
  generationId: string,
  step: string,
  trace: Record<string, unknown> | null,
): Promise<void> {
  if (!trace) {
    logFailure("трасса не прошла схему, не записана");
    return;
  }
  try {
    await repo.saveTrace(generationId, step, trace);
  } catch (error) {
    logFailure(`трасса не записана: ${error instanceof Error ? error.name : "ошибка"}`);
  }
}

/**
 * Траты шага: токены всех вызовов, включая неудачные и ретраи, в `generations.cost_*` и одной
 * строкой числовой лог. Деньги потрачены и при провале шага, поэтому зовётся в обоих исходах.
 * Сбой записи не должен ронять генерацию.
 */
async function saveCostSafe(
  costs: GenerationCostRepository,
  generationId: string,
  meter: CostMeter | undefined,
): Promise<void> {
  if (!meter) return;
  const run = meter.snapshot();
  if (run.llm.length === 0) return;
  console.error(formatCostLog("write", run));
  try {
    await costs.addStepCost(generationId, "write", run);
  } catch (error) {
    logFailure(`стоимость не записана: ${error instanceof Error ? error.name : "ошибка"}`);
  }
}

/** Перенос выбранных в Поджоге шуток (§7.1a): только валидные, не больше `selectCount`. */
async function loadCarried(
  repo: WriteRepository,
  trialGenerationId: string | null,
  tier: Tier,
): Promise<CarriedPunch[]> {
  if (tier !== 2 || trialGenerationId === null) return [];
  const rows = await repo.listSelected(trialGenerationId);
  const out: CarriedPunch[] = [];
  for (const row of rows) {
    const punch = PunchCandidate.safeParse({ id: row.punchId, emoji: row.emoji, text: row.text });
    const trace = PunchTraceSchema.safeParse(row.trace);
    if (!punch.success || !trace.success) {
      logFailure("перенос: запись Поджога не прошла схему, пропущена");
      continue;
    }
    out.push({
      id: punch.data.id,
      emoji: punch.data.emoji,
      text: punch.data.text,
      trace: trace.data,
    });
    if (out.length >= TIERS[tier].selectCount) break;
  }
  return out;
}

/** Старый писатель (rare, medium): траты и трасса шага `write` и в провале. */
async function runLegacy(
  generationId: string,
  input: WriteInput,
  deps: WriteStepDeps,
): Promise<WriteResult> {
  const writeDeps = deps.write();
  try {
    const result = await writeCandidates(input, writeDeps);
    await saveCostSafe(deps.costs, generationId, writeDeps.meter);
    return result;
  } catch (error) {
    await saveCostSafe(deps.costs, generationId, writeDeps.meter);
    // Провал (слабое не выдаём) разбирают по трассе: пишем её и отдаём ошибку дальше как есть.
    if (error instanceof WriteFailedError && error.trace) {
      await saveTraceSafe(deps.repo, generationId, WRITE_TRACE_STEP, error.trace);
      // Трасса (тексты шуток, id наблюдений) дальше с ошибкой не едет: ни в workflow, ни в логи.
      error.trace = null;
    }
    throw error;
  }
}

/** Comedy-движок (well done): траты как у `write`, трасса шага `comedy` и в провале. */
async function runComedy(
  generationId: string,
  input: ComedyInput,
  deps: WriteStepDeps,
): Promise<WriteResult<Record<string, unknown>>> {
  const comedyDeps = (deps.comedy ?? defaultComedyDeps)();
  try {
    const result = await writeComedyCandidates(input, comedyDeps);
    await saveCostSafe(deps.costs, generationId, comedyDeps.meter);
    return result;
  } catch (error) {
    await saveCostSafe(deps.costs, generationId, comedyDeps.meter);
    if (error instanceof ComedyFailedError && error.comedyTrace) {
      await saveTraceSafe(deps.repo, generationId, COMEDY_TRACE_STEP, error.comedyTrace);
      // Профиль и шутки дальше с ошибкой не едут: ни в workflow, ни в логи.
      error.comedyTrace = null;
    }
    throw error;
  }
}

/**
 * Шаг `write` с БД: вход из строк генерации → движок → кандидаты в `punch_candidates`. Степени
 * из `COMEDY_LEVELS` (well done) пишет comedy-движок, остальные — старый `writeCandidates`.
 * Идемпотентен (инвариант 8): кандидаты уже есть — модель не зовём. Провал — `WriteFailedError`
 * (workflow превращает его в `failed/internal` без ретраев). Список проходит контракт
 * `CandidatesResponse` до записи (инварианты 9, 20).
 */
export async function runWriteStep(
  generationId: string,
  deps: WriteStepDeps = defaultWriteStepDeps(),
): Promise<void> {
  const { repo } = deps;
  if (await repo.hasCandidates(generationId)) return;

  const row = await repo.loadInput(generationId);
  if (!row) throw new WriteFailedError("no_input");

  const persona = PersonaProfile.safeParse(row.persona);
  const snapshot = ProfileSnapshot.safeParse(row.snapshot);
  if (!persona.success || !snapshot.success) {
    logFailure("досье или снимок не прошли схему");
    throw new WriteFailedError("bad_input");
  }
  // Гардрейлы (инвариант 11): такое досье не должно было дойти до платных шагов.
  const { isPrivate, likelyMinor, insufficientData } = persona.data.flags;
  if (isPrivate || likelyMinor || insufficientData) throw new WriteFailedError("bad_input");

  const facts = buildProfileFacts(snapshot.data);
  const carried = await loadCarried(repo, row.trialGenerationId, row.tier);
  const comedy = isComedyLevel(row.level);
  const step = comedy ? COMEDY_TRACE_STEP : WRITE_TRACE_STEP;

  const result = comedy
    ? await runComedy(
        generationId,
        {
          source: { kind: "snapshot", snapshot: snapshot.data, facts },
          forbidden: forbiddenTopics(persona.data),
          sensitiveEvents: persona.data.sensitiveEvents ?? [],
          extraFacts: row.extraFacts,
          mode: row.mode,
          level: row.level,
          tier: row.tier,
          carried,
        },
        deps,
      )
    : await runLegacy(
        generationId,
        {
          persona: persona.data,
          facts,
          extraFacts: row.extraFacts,
          mode: row.mode,
          level: row.level,
          tier: row.tier,
          carried,
        },
        deps,
      );

  const response = CandidatesResponse.safeParse({
    generationId,
    selectCount: TIERS[row.tier].selectCount,
    candidates: result.candidates.map((c) => ({
      id: c.id,
      emoji: c.emoji,
      text: c.text,
      ...(c.fromTrial ? { fromTrial: true } : {}),
    })),
  });
  if (!response.success) {
    logFailure("список кандидатов не прошёл контракт");
    await saveTraceSafe(repo, generationId, step, result.trace);
    throw new WriteFailedError("invalid_output");
  }

  await repo.saveCandidates(generationId, result.candidates, result.promptVersion);
  await saveTraceSafe(repo, generationId, step, result.trace);
}
