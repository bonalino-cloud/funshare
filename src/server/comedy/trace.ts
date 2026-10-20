import { z } from "zod";
import type { WriteStats } from "../roast/write/types";
import {
  ComedyProfileSchema,
  InsightSchema,
  SelectionSchema,
  STRUCTURES,
  type ComedyProfile,
  type EditorScores,
  type Insight,
  type Selection,
  type Structure,
} from "./schema";

// Приватная трасса шага `comedy` для `generation_traces` (comedy-engine §5). Читает только
// админка; срок хранения 30 дней (retention). Данные от LLM сюда приходят уже проверенными
// кодом шага; здесь вторая проверка границ перед записью в БД (инвариант 9).

export const COMEDY_TRACE_STEP = "comedy";
export const COMEDY_TRACE_VERSION = 1;

/** Где и почему кандидата не стало; `reserve` — прошёл всё, но не понадобился. */
export const COMEDY_OUTCOMES = [
  "dropped_layer4",
  "dropped_editor",
  "dropped_layer5",
  "unmoderated",
  "reserve",
  "chosen",
] as const;
export type ComedyOutcome = (typeof COMEDY_OUTCOMES)[number];

const TEXT_CAP = 400;
const ID_CAP = 80;
/** Потолок записей кандидатов: два раунда по 15–30 и брак модели с запасом. */
export const MAX_TRACE_CANDIDATES = 200;

const Score05 = z.number().int().min(0).max(5);

export const ComedyTraceCandidate = z.object({
  round: z.number().int().min(1).max(5),
  insightId: z.string().max(ID_CAP),
  structure: z.enum(STRUCTURES).nullable(),
  emoji: z.string().max(40).nullable(),
  /** `null`: ответ не по схеме или утечка промпта (кусок промпта в БД не храним). */
  text: z.string().max(TEXT_CAP).nullable(),
  outcome: z.enum(COMEDY_OUTCOMES),
  /** Код причины: слой 4, редактор (`broken`, `clarity`, `duplicate`, `no_score`), слой 5. */
  reason: z.string().max(ID_CAP).nullable(),
  scores: z
    .object({
      surprise: Score05,
      specificity: Score05,
      punch: Score05,
      rhythm: Score05,
      clarity: Score05,
    })
    .nullable(),
  totalScore: z.number().int().min(0).max(25).nullable(),
  broken: z.boolean().nullable(),
  verdict: z.object({ hitsClosedTopic: z.boolean(), selfContained: z.boolean() }).nullable(),
  punchId: z.string().max(ID_CAP).nullable(),
});
export type ComedyTraceEntry = z.infer<typeof ComedyTraceCandidate>;

const Counts = z.record(z.string(), z.number().int().min(0));
const Ms = z.number().int().min(0);

export const ComedyTrace = z.object({
  version: z.literal(COMEDY_TRACE_VERSION),
  result: z.enum(["ok", "failed"]),
  failure: z.string().max(ID_CAP).nullable(),
  level: z.enum(["rare", "medium", "well_done"]),
  mode: z.enum(["self", "friend"]),
  tier: z.number().int().min(1).max(3),
  material: z
    .object({
      source: z.enum(["apify", "agent-reach"]),
      posts: z.number().int().min(0),
      images: z.array(z.string().max(20)).max(20),
      extraFacts: z.number().int().min(0),
    })
    .nullable(),
  prompts: z.object({
    profile: z.string(),
    insights: z.string(),
    select: z.string(),
    punch: z.string(),
    editor: z.string(),
    moderator: z.string(),
  }),
  /** Модель каждой роли (профиль, инсайты, отбор, генератор, редактор, модератор). */
  models: z.object({
    profile: z.string().max(ID_CAP),
    insights: z.string().max(ID_CAP),
    select: z.string().max(ID_CAP),
    punch: z.string().max(ID_CAP),
    editor: z.string().max(ID_CAP),
    moderator: z.string().max(ID_CAP),
  }),
  /** Тайминги подшагов, мс (раунды суммируются). */
  timingsMs: z.record(z.string(), Ms),
  profile: ComedyProfileSchema.nullable(),
  insights: z.array(InsightSchema).max(60),
  selection: SelectionSchema.nullable(),
  rounds: z
    .array(
      z.object({
        round: z.number().int().min(1).max(5),
        insightIds: z.array(z.string().max(ID_CAP)).max(15),
      }),
    )
    .max(5),
  carriedPunchIds: z.array(z.string().max(ID_CAP)).max(20),
  candidates: z.array(ComedyTraceCandidate).max(MAX_TRACE_CANDIDATES),
  omittedCandidates: z.number().int().min(0),
  stats: z.object({
    rounds: z.number().int(),
    written: z.number().int(),
    droppedInvalid: z.number().int(),
    droppedByJudge: z.number().int(),
    unscored: z.number().int(),
    droppedByModerator: z.number().int(),
    unmoderated: z.number().int(),
  }),
  filters: z.object({
    layer4: Counts,
    layer5: Counts,
    moderatorChecked: z.number().int().min(0),
    moderatorPasses: z.number().int().min(0),
  }),
});
export type ComedyTrace = z.infer<typeof ComedyTrace>;

const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

export function newComedyEntry(init: {
  round: number;
  insightId: string;
  structure?: Structure | null;
  emoji?: string | null;
  text?: string | null;
}): ComedyTraceEntry {
  return {
    round: init.round,
    insightId: cut(init.insightId, ID_CAP),
    structure: init.structure ?? null,
    emoji: init.emoji ? cut(init.emoji, 40) : null,
    text: init.text == null ? null : cut(init.text, TEXT_CAP),
    // Пока никто не вычеркнул, кандидат считается запасным.
    outcome: "reserve",
    reason: null,
    scores: null,
    totalScore: null,
    broken: null,
    verdict: null,
    punchId: null,
  };
}

export function setEditorScores(
  entry: ComedyTraceEntry,
  scores: EditorScores,
  total: number,
  broken: boolean,
): void {
  entry.scores = {
    surprise: scores.surprise,
    specificity: scores.specificity,
    punch: scores.punch,
    rhythm: scores.rhythm,
    clarity: scores.clarity,
  };
  entry.totalScore = total;
  entry.broken = broken;
}

export type ComedyCounters = Omit<WriteStats, "rounds">;

type Header = {
  level: ComedyTrace["level"];
  mode: ComedyTrace["mode"];
  tier: number;
  prompts: ComedyTrace["prompts"];
  models: ComedyTrace["models"];
};

/** Сборщик трассы одного запуска: копит по ходу шага, в конце отдаёт проверенную трассу. */
export class ComedyTraceRecorder {
  readonly entries: ComedyTraceEntry[] = [];
  readonly rounds: { round: number; insightIds: string[] }[] = [];
  readonly timings: Record<string, number> = {};
  material: ComedyTrace["material"] = null;
  profile: ComedyProfile | null = null;
  insights: Insight[] = [];
  selection: Selection | null = null;
  carriedPunchIds: string[] = [];
  /** Живая ссылка на счётчики шага, ставится при старте. */
  counters: ComedyCounters | null = null;

  constructor(private readonly header: Header) {}

  add(entry: ComedyTraceEntry): void {
    this.entries.push(entry);
  }

  addRound(round: number, insightIds: readonly string[]): void {
    this.rounds.push({ round, insightIds: insightIds.map((id) => cut(id, ID_CAP)) });
  }

  addTiming(name: string, ms: number): void {
    this.timings[name] = (this.timings[name] ?? 0) + Math.max(0, Math.round(ms));
  }

  /** `null`, если собранное не прошло схему (трасса не должна ронять генерацию). */
  build(outcome: { result: "ok" } | { result: "failed"; failure: string }): ComedyTrace | null {
    const { filters, ...counts } = this.counters ?? {
      written: 0,
      droppedInvalid: 0,
      droppedByJudge: 0,
      unscored: 0,
      droppedByModerator: 0,
      unmoderated: 0,
      filters: { layer4: {}, layer5: {}, moderatorChecked: 0, moderatorPasses: 0 },
    };
    const parsed = ComedyTrace.safeParse({
      version: COMEDY_TRACE_VERSION,
      result: outcome.result,
      failure: outcome.result === "failed" ? outcome.failure : null,
      ...this.header,
      material: this.material,
      timingsMs: this.timings,
      profile: this.profile,
      insights: this.insights,
      selection: this.selection,
      rounds: this.rounds,
      carriedPunchIds: this.carriedPunchIds,
      candidates: this.entries.slice(0, MAX_TRACE_CANDIDATES),
      omittedCandidates: Math.max(0, this.entries.length - MAX_TRACE_CANDIDATES),
      stats: { rounds: this.rounds.length, ...counts },
      filters,
    });
    return parsed.success ? parsed.data : null;
  }
}
