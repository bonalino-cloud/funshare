import { z } from "zod";
import { JOKE_MECHANISMS } from "../jokes/card";
import type { JudgeScores, WriteStats } from "./types";
import type { ModeratorItem } from "./schema";

// Приватная трасса шага `write` для `generation_traces` (roast-engine §8, §9.5). Нужна админке:
// где промпт и фильтры промахиваются. Наружу не отдаётся ни одним роутом. Данные от LLM к этому
// месту уже прошли zod шага; здесь вторая проверка границ перед записью в БД (инвариант 9).

export const WRITE_TRACE_STEP = "write";
export const WRITE_TRACE_VERSION = 1;

/** Где и почему кандидата не стало; `chosen` — вошёл в выдачу, `reserve` — прошёл всё, но не понадобился. */
export const TRACE_OUTCOMES = [
  "dropped_layer4",
  "dropped_judge",
  "unscored",
  "dropped_layer5",
  "unmoderated",
  "reserve",
  "chosen",
] as const;
export type TraceOutcome = (typeof TRACE_OUTCOMES)[number];

const TEXT_CAP = 400;
/** Потолок записей кандидатов в трассе: ~400 × ~0.6 КБ ≈ 250 КБ jsonb на генерацию. */
export const MAX_TRACE_CANDIDATES = 400;
const ID_CAP = 80;

const Score = z.number().int().min(0).max(5);

export const TraceCandidate = z.object({
  round: z.number().int().min(1).max(10),
  /** Крючок: id наблюдения из досье (для неизвестного модели крючка — как она его назвала). */
  hookId: z.string().max(ID_CAP),
  mechanism: z.enum(JOKE_MECHANISMS).nullable(),
  /** Карточка банка, чей скелет дан писателю. */
  jokeCardId: z.string().max(ID_CAP).nullable(),
  emoji: z.string().max(40).nullable(),
  /**
   * Текст шутки. `null`: ответ не по схеме (текста нет) или вычеркнута слоем 4 за утечку
   * промпта (кусок промпта в БД не храним).
   */
  text: z.string().max(TEXT_CAP).nullable(),
  evidenceRef: z
    .string()
    .max(ID_CAP + 40)
    .nullable(),
  outcome: z.enum(TRACE_OUTCOMES),
  /** Код причины: слой 4 (`topic_health`, `prompt_leak` …) или слой 5 (`not_behavior` …). */
  reason: z.string().max(ID_CAP).nullable(),
  scores: z
    .object({
      recognizability: Score,
      surprise: Score,
      brevity: Score,
      aboutBehavior: Score,
      warmth: Score,
    })
    .nullable(),
  totalScore: z.number().nullable(),
  /** Вердикт модератора (слой 5), если он был. */
  verdict: z
    .object({
      aboutBehavior: z.boolean(),
      hitsForbiddenTopic: z.boolean(),
      friendSafe: z.boolean(),
      selfContained: z.boolean(),
    })
    .nullable(),
  /** `PunchCandidate.id` из выдачи, только у `chosen`. */
  punchId: z.string().max(ID_CAP).nullable(),
});
export type TraceCandidate = z.infer<typeof TraceCandidate>;

const Counts = z.record(z.string(), z.number().int().min(0));

export const WriteTrace = z.object({
  version: z.literal(WRITE_TRACE_VERSION),
  /** `ok` — шаг дал выдачу; `failed` — слабое не выдали, `failure` — код причины. */
  result: z.enum(["ok", "failed"]),
  failure: z.string().max(ID_CAP).nullable(),
  level: z.enum(["rare", "medium", "well_done"]),
  mode: z.enum(["self", "friend"]),
  tier: z.number().int().min(1).max(3),
  prompts: z.object({ writer: z.string(), judge: z.string(), moderator: z.string() }),
  models: z.object({ writer: z.string(), judge: z.string(), moderator: z.string() }),
  /** Крючки по раундам: id наблюдений из досье (текст наблюдений лежит в `personas`). */
  rounds: z
    .array(
      z.object({
        round: z.number().int().min(1).max(10),
        hookIds: z.array(z.string().max(ID_CAP)).max(40),
      }),
    )
    .max(10),
  /** Перенесённые из Поджога шутки (их трасса лежит у генерации Поджога). */
  carriedPunchIds: z.array(z.string().max(ID_CAP)).max(20),
  candidates: z.array(TraceCandidate).max(MAX_TRACE_CANDIDATES),
  /** Сколько записей не влезло в потолок (модель вернула слишком много брака). */
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
  /** `FilterReport` как есть: счётчики по слоям и кодам причин. */
  filters: z.object({
    layer4: Counts,
    layer5: Counts,
    moderatorChecked: z.number().int().min(0),
    moderatorPasses: z.number().int().min(0),
  }),
});
export type WriteTrace = z.infer<typeof WriteTrace>;

/** Живая запись кандидата: меняется по ходу шага, в трассу уходит итоговое состояние. */
export type TraceEntry = TraceCandidate;

const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

export function newEntry(init: {
  round: number;
  hookId: string;
  mechanism?: TraceEntry["mechanism"];
  jokeCardId?: string | null;
  emoji?: string | null;
  text?: string | null;
  evidenceRef?: string | null;
}): TraceEntry {
  return {
    round: init.round,
    hookId: cut(init.hookId, ID_CAP),
    mechanism: init.mechanism ?? null,
    jokeCardId: init.jokeCardId ? cut(init.jokeCardId, ID_CAP) : null,
    emoji: init.emoji ? cut(init.emoji, 40) : null,
    text: init.text == null ? null : cut(init.text, TEXT_CAP),
    evidenceRef: init.evidenceRef ? cut(init.evidenceRef, ID_CAP + 40) : null,
    // Пока никто не вычеркнул, кандидат считается запасным.
    outcome: "reserve",
    reason: null,
    scores: null,
    totalScore: null,
    verdict: null,
    punchId: null,
  };
}

export function setVerdict(entry: TraceEntry, v: ModeratorItem): void {
  entry.verdict = {
    aboutBehavior: v.aboutBehavior,
    hitsForbiddenTopic: v.hitsForbiddenTopic,
    friendSafe: v.friendSafe,
    selfContained: v.selfContained,
  };
}

export function setScores(entry: TraceEntry, scores: JudgeScores, total: number): void {
  entry.scores = { ...scores };
  entry.totalScore = total;
}

/** Сборщик трассы одного запуска `write`: копит записи, в конце отдаёт проверенную трассу. */
export class TraceRecorder {
  readonly entries: TraceEntry[] = [];
  readonly rounds: { round: number; hookIds: string[] }[] = [];
  carriedPunchIds: string[] = [];

  constructor(
    private readonly header: {
      level: WriteTrace["level"];
      mode: WriteTrace["mode"];
      tier: number;
      prompts: WriteTrace["prompts"];
      models: WriteTrace["models"];
    },
  ) {}

  add(entry: TraceEntry): void {
    this.entries.push(entry);
  }

  addRound(round: number, hookIds: readonly string[]): void {
    this.rounds.push({ round, hookIds: hookIds.map((id) => cut(id, ID_CAP)) });
  }

  /** Номер текущего раунда писателя: им помечаются новые записи. */
  round = 1;
  /** Счётчики шага (те же, что в `WriteStats`); живая ссылка, ставится при старте. */
  counters: Omit<WriteStats, "rounds"> | null = null;

  /** `null`, если собранное не прошло схему (трасса не должна ронять генерацию). */
  build(outcome: { result: "ok" } | { result: "failed"; failure: string }): WriteTrace | null {
    const { filters, ...counts } = this.counters ?? {
      written: 0,
      droppedInvalid: 0,
      droppedByJudge: 0,
      unscored: 0,
      droppedByModerator: 0,
      unmoderated: 0,
      filters: { layer4: {}, layer5: {}, moderatorChecked: 0, moderatorPasses: 0 },
    };
    const parsed = WriteTrace.safeParse({
      version: WRITE_TRACE_VERSION,
      result: outcome.result,
      failure: outcome.result === "failed" ? outcome.failure : null,
      ...this.header,
      rounds: this.rounds,
      carriedPunchIds: this.carriedPunchIds,
      // Лишнее отрезаем, а не роняем всю трассу: первые записи важнее для разбора.
      candidates: this.entries.slice(0, MAX_TRACE_CANDIDATES),
      omittedCandidates: Math.max(0, this.entries.length - MAX_TRACE_CANDIDATES),
      stats: { rounds: this.rounds.length, ...counts },
      filters,
    });
    return parsed.success ? parsed.data : null;
  }
}
