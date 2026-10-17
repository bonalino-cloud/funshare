import { randomUUID } from "node:crypto";
import { createCoverFetcher } from "../analyze/cover-fetch";
import { CostMeter } from "../cost/meter";
import { capCodepoints } from "../facts/text";
import { PROMPT_VERSION as EDITOR_V } from "../prompts/comedy/editor-v1";
import { PROMPT_VERSION as INSIGHTS_V } from "../prompts/comedy/insights-v1";
import { PROMPT_VERSION as MODERATOR_V } from "../prompts/comedy/moderator-v1";
import { PROMPT_VERSION as PROFILE_V } from "../prompts/comedy/profile-v1";
import { PROMPT_VERSION as PUNCH_V } from "../prompts/comedy/punch-v1";
import { PROMPT_VERSION as SELECT_V } from "../prompts/comedy/select-v1";
import { emptyReport, formatReport } from "../roast/filters";
import { normalizeForDedupe } from "../roast/write/candidate";
import { maxNewCandidates, MIN_CANDIDATES_BY_LEVEL } from "../roast/write/config";
import { WriteFailedError, type WriteStats, type WrittenCandidate } from "../roast/write/types";
import type { WriteResult } from "../roast/write/write-candidates";
import {
  COMEDY_BUDGET_MS,
  COMEDY_TASTE_PACK,
  isComedyLevel,
  MAX_ROUNDS,
  maxPerInsight,
  MODERATION_PASSES,
  STRUCTURE_MECHANISM,
} from "./config";
import { editRound, pickForOutput, type EditedRound } from "./editor";
import { findInsights, selectInsights } from "./insights";
import { comedyModels, createComedyGenerate, type ComedyRole } from "./llm";
import { fetchMaterialImages, fromSnapshot } from "./material";
import { moderatePass } from "./moderate";
import { buildComedyProfile, factSource } from "./profile";
import { writePunches } from "./punches";
import type { Insight } from "./schema";
import type { Candidate, RunContext } from "./state";
import { ComedyTraceRecorder, type ComedyCounters, type ComedyTrace } from "./trace";
import type { ComedyDeps, ComedyInput, ComedyMaterial } from "./types";

// Comedy-движок шага `write` для well done (comedy-engine §1): материал → профиль → инсайты
// A|B|C → отбор 10+5 → панчи → слой 4 → редактор → модератор. Результат того же типа, что у
// старого писателя (`WriteResult`), поэтому `runWriteStep` пишет кандидатов тем же путём.

export const COMEDY_PROMPTS: ComedyTrace["prompts"] = {
  profile: PROFILE_V,
  insights: INSIGHTS_V,
  select: SELECT_V,
  punch: PUNCH_V,
  editor: EDITOR_V,
  moderator: MODERATOR_V,
};

/** Провал comedy-движка: трасса едет к `runWriteStep` вместе с ошибкой (шаг `comedy`). */
export class ComedyFailedError extends WriteFailedError {
  comedyTrace: ComedyTrace | null = null;
}

export type ComedyResult = WriteResult<ComedyTrace>;

/** Реальные реализации создаются лениво: сборка и тесты не требуют ключа и сети. */
export function defaultComedyDeps(): ComedyDeps {
  const meter = new CostMeter();
  // Один срок на все вызовы запуска: шаг не упрётся в лимит функции (config `COMEDY_BUDGET_MS`).
  const deadlineAt = Date.now() + COMEDY_BUDGET_MS;
  const generate = (role: ComedyRole) => createComedyGenerate(role, { meter, deadlineAt });
  return {
    meter,
    profile: generate("profile"),
    insights: generate("insights"),
    select: generate("select"),
    punch: generate("punch"),
    editor: generate("editor"),
    moderator: generate("moderator"),
    fetchCovers: createCoverFetcher(),
    models: comedyModels(),
    newId: () => `p_${randomUUID().slice(0, 8)}`,
  };
}

/** Список «нельзя»: запретные темы досье ∪ закрытые темы профиля, без дублей. */
export function mergeTopics(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of lists.flat()) {
    const key = topic.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(topic.trim());
  }
  return out;
}

async function loadMaterial(input: ComedyInput, deps: ComedyDeps): Promise<ComedyMaterial> {
  if (input.source.kind === "material") return input.source.material;
  const { snapshot, facts } = input.source;
  const images = await fetchMaterialImages(snapshot, deps.fetchCovers);
  return fromSnapshot(snapshot, facts, input.extraFacts, images);
}

function emptyCounters(): ComedyCounters {
  return {
    written: 0,
    droppedInvalid: 0,
    droppedByJudge: 0,
    unscored: 0,
    droppedByModerator: 0,
    unmoderated: 0,
    filters: emptyReport(),
  };
}

/** Одна строка на генерацию: только числа, коды и тайминги, без текстов. */
function logSummary(rec: ComedyTraceRecorder, outcome: string, issued: string): void {
  const c = rec.counters ?? emptyCounters();
  const byCategory = ["A", "B", "C"]
    .map((k) => `${k}:${rec.insights.filter((i) => i.category === k).length}`)
    .join(",");
  const timings = Object.entries(rec.timings)
    .map(([k, ms]) => `${k}:${ms}`)
    .join(",");
  console.error(
    `[comedy] итог=${outcome} источник=${rec.material?.source ?? "-"} постов=${rec.material?.posts ?? 0} картинок=${rec.material?.images.length ?? 0} фактов=${rec.profile?.facts.length ?? 0} цитат=${rec.profile?.quotes.length ?? 0} инсайтов=${byCategory} отбор=${rec.selection?.picks.length ?? 0}(+${rec.selection?.toppedUp ?? 0}) раундов=${rec.rounds.length} написано=${c.written} брак=${c.droppedInvalid} редактор_вырезал=${c.droppedByJudge} без_оценки=${c.unscored} модератор_вырезал=${c.droppedByModerator} без_вердикта=${c.unmoderated} ${formatReport(c.filters)} выдано=${issued} мс=${timings || "-"}`,
  );
}

/**
 * Модерация раунда: выбор редактора (с добором по оценкам), затем замена вычеркнутых следующими
 * по сумме оценок, пока не набрано `maxNew` или не кончились проходы и годные кандидаты.
 */
async function moderateRound(
  edited: EditedRound,
  approved: Candidate[],
  maxNew: number,
  cap: number,
  ctx: RunContext,
): Promise<void> {
  const moderated = new Set<Candidate>();
  let batch = pickForOutput({
    picked: edited.picked,
    pool: edited.pool,
    need: maxNew - approved.length,
    cap,
    taken: approved,
  });
  for (let pass = 1; pass <= MODERATION_PASSES && batch.length > 0; pass++) {
    for (const c of batch) moderated.add(c);
    approved.push(...(await moderatePass(batch, approved.length > 0, ctx)));
    const need = maxNew - approved.length;
    if (need <= 0) return;
    // Последний проход добирает по сумме оценок без ограничения на инсайт.
    const last = pass + 1 === MODERATION_PASSES;
    batch = pickForOutput({
      picked: [],
      pool: edited.pool.filter((c) => !moderated.has(c)),
      need,
      cap: last ? Number.POSITIVE_INFINITY : cap,
      taken: approved,
    });
  }
}

type Timed = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

async function runRounds(
  rounds: readonly (readonly Insight[])[],
  input: ComedyInput,
  ctx: RunContext,
  timed: Timed,
): Promise<Candidate[]> {
  const carried = input.carried ?? [];
  const carriedTexts = carried.map((p) => p.text);
  const maxNew = maxNewCandidates(input.tier);
  const minTotal = MIN_CANDIDATES_BY_LEVEL[input.level];
  const cap = maxPerInsight(maxNew);
  const seen = new Set(carried.map((p) => normalizeForDedupe(p.text)));
  const written: string[] = [];
  const approved: Candidate[] = [];

  for (const [i, insights] of rounds.entries()) {
    const round = i + 1;
    if (round > MAX_ROUNDS || insights.length === 0) break;
    if (round > 1 && carried.length + approved.length >= minTotal) break;
    ctx.rec.addRound(
      round,
      insights.map((x) => x.id),
    );
    const already = [...carriedTexts, ...written];
    const cands = await timed("punch", () => writePunches(insights, already, seen, round, ctx));
    written.push(...cands.map((c) => c.text));
    const chosenTexts = [...carriedTexts, ...approved.map((c) => c.text)];
    const edited = await timed("editor", () =>
      editRound(cands, maxNew - approved.length, cap, chosenTexts, ctx),
    );
    await timed("moderator", () => moderateRound(edited, approved, maxNew, cap, ctx));
  }
  return approved.slice(0, maxNew);
}

function buildResult(
  chosen: readonly Candidate[],
  input: ComedyInput,
  ctx: RunContext,
  insights: ReadonlyMap<string, Insight>,
): WrittenCandidate[] {
  const carried = input.carried ?? [];
  const taken = new Set(carried.map((p) => p.id));
  const freshId = (c: Candidate) => {
    for (let i = 0; i < 10; i++) {
      const id = ctx.deps.newId();
      if (!taken.has(id)) {
        taken.add(id);
        c.entry.outcome = "chosen";
        c.entry.punchId = id;
        return id;
      }
    }
    throw new WriteFailedError("llm_failed");
  };
  const { models } = ctx.deps;
  return [
    ...carried.map((p): WrittenCandidate => ({ ...p, fromTrial: true })),
    ...chosen.map((c): WrittenCandidate => ({
      id: freshId(c),
      emoji: c.emoji,
      text: c.text,
      fromTrial: false,
      trace: {
        hookId: c.insightId,
        mechanism: STRUCTURE_MECHANISM[c.structure],
        evidenceRef: capCodepoints(
          factSource(ctx.profile, insights.get(c.insightId)?.factIds[0]),
          100,
        ),
        jokeCardId: null,
        scores: null,
        totalScore: c.total,
        tastePack: COMEDY_TASTE_PACK,
        promptVersion: PUNCH_V,
        writerModel: models.punch,
        judgeModel: models.editor,
        structure: c.structure,
        insightId: c.insightId,
      },
    })),
  ];
}

async function run(
  input: ComedyInput,
  deps: ComedyDeps,
  rec: ComedyTraceRecorder,
  timed: Timed,
): Promise<ComedyResult> {
  const counters = emptyCounters();
  rec.counters = counters;
  rec.carriedPunchIds = (input.carried ?? []).map((p) => p.id);

  const material = await timed("material", () => loadMaterial(input, deps));
  rec.material = {
    source: material.source,
    posts: material.posts.length,
    images: material.images.map((i) => i.label),
    extraFacts: material.extraFacts.length,
  };
  const profile = await timed("profile", () => buildComedyProfile(material, deps.profile));
  rec.profile = profile;

  const ctx: RunContext = {
    level: input.level,
    mode: input.mode,
    forbidden: mergeTopics(input.forbidden, profile.closedTopics),
    profile,
    deps,
    rec,
    counters,
  };
  const insights = await timed("insights", () =>
    findInsights({ profile, mode: input.mode, forbidden: ctx.forbidden, generate: deps.insights }),
  );
  rec.insights = insights;
  const selection = await timed("select", () =>
    selectInsights(profile, insights, ctx.forbidden, deps.select),
  );
  rec.selection = selection;

  const byId = new Map(insights.map((i) => [i.id, i]));
  const pick = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const insight = byId.get(id);
      return insight ? [insight] : [];
    });
  const chosen = await runRounds(
    [pick(selection.work), pick(selection.reserve)],
    input,
    ctx,
    timed,
  );

  const carried = input.carried ?? [];
  if (carried.length + chosen.length < MIN_CANDIDATES_BY_LEVEL[input.level]) {
    throw new WriteFailedError("not_enough_candidates");
  }
  const candidates = buildResult(chosen, input, ctx, byId);
  const stats: WriteStats = { rounds: rec.rounds.length, ...counters };
  return {
    candidates,
    stats,
    tastePack: COMEDY_TASTE_PACK,
    promptVersion: PUNCH_V,
    moderator: { promptVersion: MODERATOR_V, model: deps.models.moderator },
    trace: null,
  };
}

/**
 * Comedy-движок без БД. Всё, что вернула модель, проходит проверку кодом до выдачи. Меньше
 * минимума степени после второго раунда — `not_enough_candidates` (слабое не выдаём). Провал
 * бросает `ComedyFailedError` (это `WriteFailedError`) с трассой для разбора.
 */
export async function writeComedyCandidates(
  input: ComedyInput,
  deps: ComedyDeps = defaultComedyDeps(),
): Promise<ComedyResult> {
  // Промпты comedy написаны под 18+: на другой степени движок не запускается вовсе.
  if (!isComedyLevel(input.level)) throw new WriteFailedError("bad_input");
  const rec = new ComedyTraceRecorder({
    level: input.level,
    mode: input.mode,
    tier: input.tier,
    prompts: COMEDY_PROMPTS,
    models: deps.models,
  });
  const clock = deps.now ?? (() => performance.now());
  const started = clock();
  const timed: Timed = async (name, fn) => {
    const t = clock();
    try {
      return await fn();
    } finally {
      rec.addTiming(name, clock() - t);
    }
  };
  try {
    const result = await run(input, deps, rec, timed);
    rec.addTiming("total", clock() - started);
    const fresh = result.candidates.filter((c) => !c.fromTrial).length;
    logSummary(rec, "ok", `${fresh}+${result.candidates.length - fresh}`);
    return { ...result, trace: rec.build({ result: "ok" }) };
  } catch (error) {
    rec.addTiming("total", clock() - started);
    if (!(error instanceof WriteFailedError)) throw error;
    logSummary(rec, `failed:${error.reason}`, "0");
    const failed = new ComedyFailedError(error.reason);
    failed.comedyTrace = rec.build({ result: "failed", failure: error.reason });
    throw failed;
  }
}
