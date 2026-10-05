import { randomUUID } from "node:crypto";
import type { Level } from "@/contracts";
import {
  buildJudgePrompt,
  buildWriterPrompt,
  PROMPT_VERSION,
  promptHookId,
} from "../../prompts/roast/v1";
import { LlmSchemaError } from "../../analyze/llm";
import { listCards } from "../jokes/repository";
import { pickStyles, type BankCards } from "./bank";
import {
  normalizeForDedupe,
  totalScore,
  validateCandidate,
  type ValidCandidate,
} from "./candidate";
import {
  CANDIDATES_PER_HOOK,
  JUDGE_CANDIDATES_PER_CALL,
  judgeThresholds,
  MAX_ATTEMPTS,
  MAX_ROUNDS,
  maxNewCandidates,
  MIN_CANDIDATES_BY_LEVEL,
  WRITER_HOOKS_PER_CALL,
} from "./config";
import { forbiddenTopics } from "../../analyze/forbidden";
import { eligibleHooks, overlapsForbidden, selectHooks } from "./hooks";
import {
  createAnthropicJudge,
  createAnthropicWriter,
  JUDGE_MODEL,
  WRITER_MODEL,
  type GenerateFn,
  type PromptText,
} from "./llm";
import { JudgeEnvelope, JudgeItem, WriterEnvelope } from "./schema";
import {
  WriteFailedError,
  type CarriedPunch,
  type Hook,
  type HookStyle,
  type JudgeScores,
  type WriteInput,
  type WriteStats,
  type WrittenCandidate,
} from "./types";

export type WriteDeps = {
  writer: GenerateFn;
  judge: GenerateFn;
  /** Банк карточек уровня (одобренные, без красных линий в образцах). */
  loadBank: (level: Level) => Promise<BankCards>;
  models: { writer: string; judge: string };
  /** Идентификатор нового кандидата. Должен быть уникален; повтор при совпадении проверяет код. */
  newId: () => string;
};

/** Реальные реализации создаются лениво: сборка и тесты не требуют ключа и БД. */
export function defaultWriteDeps(): WriteDeps {
  return {
    writer: createAnthropicWriter(),
    judge: createAnthropicJudge(),
    loadBank: async (level) => ({
      skeletons: await listCards({ level, kind: "skeleton" }),
      examples: await listCards({ level, kind: "example" }),
    }),
    models: { writer: WRITER_MODEL, judge: JUDGE_MODEL },
    newId: () => `p_${randomUUID().slice(0, 8)}`,
  };
}

export type WriteResult = {
  /** Сначала перенесённые из Поджога, затем новые по убыванию оценки судьи. */
  candidates: WrittenCandidate[];
  stats: WriteStats;
  promptVersion: string;
};

/** В лог — только счётчики и имя ошибки: ни текста профиля, ни ответа модели, ни ключа. */
function logFailure(event: string, detail?: unknown) {
  const name = detail instanceof Error ? detail.name : "";
  console.error(`[write] ${event}${name ? `: ${name}` : ""}`);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; note: string };

/**
 * Вызов модели с ретраями: сбой вызова или ответ, который `parse` не принял, дают ещё до двух
 * попыток; причина (наш текст) идёт в промпт. Исчерпаны — `llm_failed`.
 */
async function withRetries<T>(
  label: string,
  prompt: (note: string | undefined) => PromptText,
  generate: GenerateFn,
  parse: (raw: unknown) => Parsed<T>,
): Promise<T> {
  let note: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: unknown;
    try {
      raw = await generate(prompt(note));
    } catch (error) {
      logFailure(`${label}: попытка ${attempt}: сбой вызова`, error);
      note = error instanceof LlmSchemaError ? error.message : undefined;
      continue;
    }
    const parsed = parse(raw);
    if (parsed.ok) return parsed.value;
    logFailure(`${label}: попытка ${attempt}: ответ не принят`);
    note = parsed.note;
  }
  throw new WriteFailedError("llm_failed");
}

type RoundCandidate = ValidCandidate & { key: string };

type Scored = {
  hookId: string;
  order: number;
  candidate: ValidCandidate;
  scores: JudgeScores;
  total: number;
};

type Counters = Pick<WriteStats, "written" | "droppedInvalid" | "droppedByJudge" | "unscored">;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Пачки параллельно. Пачка, исчерпавшая ретраи, отпадает: её кандидатов нет, а хватит ли
 * остальных, решает минимум уровня. Отпали все — `llm_failed`; чужая ошибка (баг) — как есть.
 */
async function settleBatches<T>(label: string, tasks: readonly Promise<T>[]): Promise<T[]> {
  if (tasks.length === 0) return [];
  const results = await Promise.allSettled(tasks);
  const ok: T[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") ok.push(r.value);
    else if (!(r.reason instanceof WriteFailedError)) throw r.reason;
  }
  if (ok.length === 0) throw new WriteFailedError("llm_failed");
  if (ok.length < results.length) {
    logFailure(`${label}: отпало пачек ${results.length - ok.length} из ${results.length}`);
  }
  return ok;
}

/**
 * Писатель: до 3 кандидатов на крючок, каждый проверен кодом. Крючки идут пачками по
 * `WRITER_HOOKS_PER_CALL`, пачки параллельно: размер ответа не зависит от тарифа.
 */
async function writeRound(
  input: WriteInput,
  styles: readonly HookStyle[],
  alreadyWritten: readonly string[],
  seen: Set<string>,
  counters: Counters,
  deps: WriteDeps,
): Promise<RoundCandidate[]> {
  const parts = await settleBatches(
    "писатель",
    chunk(styles, WRITER_HOOKS_PER_CALL).map((part) =>
      writeBatch(input, part, alreadyWritten, seen, counters, deps),
    ),
  );
  return parts.flat();
}

async function writeBatch(
  input: WriteInput,
  styles: readonly HookStyle[],
  alreadyWritten: readonly string[],
  seen: Set<string>,
  counters: Counters,
  deps: WriteDeps,
): Promise<RoundCandidate[]> {
  // Модель видит id после чистки промпта и отвечает им; сырой id тоже принимаем.
  const byHook = new Map<string, HookStyle>();
  for (const s of styles) byHook.set(promptHookId(s.hook.id), s).set(s.hook.id, s);
  const forbidden = forbiddenTopics(input.persona);
  return withRetries(
    "писатель",
    (retryNote) =>
      buildWriterPrompt({
        persona: input.persona,
        facts: input.facts,
        extraFacts: input.extraFacts,
        styles,
        level: input.level,
        mode: input.mode,
        alreadyWritten,
        retryNote,
      }),
    deps.writer,
    (raw) => {
      const env = WriterEnvelope.safeParse(raw);
      if (!env.success) return { ok: false, note: "ответ не по схеме: нужен объект hooks" };
      const out: RoundCandidate[] = [];
      const localSeen = new Set(seen);
      let invalid = 0;
      const perHook = new Map<string, number>();
      for (const group of env.data.hooks) {
        const style = byHook.get(group.hookId);
        if (!style) {
          invalid += group.candidates.length;
          continue;
        }
        for (const raw of group.candidates) {
          if ((perHook.get(style.hook.id) ?? 0) >= CANDIDATES_PER_HOOK) break;
          const v = validateCandidate(raw, style);
          if (!v.ok) {
            invalid++;
            continue;
          }
          // Страховка кодом поверх промпта: запретная тема в тексте шутки вычёркивает её.
          if (overlapsForbidden(v.value.text, forbidden)) {
            invalid++;
            continue;
          }
          const key = normalizeForDedupe(v.value.text);
          if (localSeen.has(key)) {
            invalid++;
            continue;
          }
          localSeen.add(key);
          perHook.set(style.hook.id, (perHook.get(style.hook.id) ?? 0) + 1);
          out.push({ ...v.value, key });
        }
      }
      if (out.length === 0) {
        return {
          ok: false,
          note: "ни один кандидат не принят: нужны русские шутки до 140 знаков, hookId как в <hooks>, mechanism из схемы",
        };
      }
      // Принятое запоминаем только при успехе попытки: неудачная не должна занять тексты.
      for (const c of out) seen.add(c.key);
      counters.written += out.length;
      counters.droppedInvalid += invalid;
      return { ok: true, value: out };
    },
  );
}

/**
 * Судья: оценки 0–5, вырезаем ниже порога по «про поведение» и «тепло». Кандидаты идут пачками
 * по `JUDGE_CANDIDATES_PER_CALL`, пачки параллельно: ответ не упирается в лимит токенов.
 */
async function judgeRound(
  input: WriteInput,
  hooks: readonly Hook[],
  candidates: readonly RoundCandidate[],
  counters: Counters,
  deps: WriteDeps,
  orderBase: number,
): Promise<Scored[]> {
  const ids = candidates.map((c, i) => ({ id: `c${i + 1}`, c }));
  const thresholds = judgeThresholds(input.level);

  const batches = await settleBatches(
    "судья",
    chunk(ids, JUDGE_CANDIDATES_PER_CALL).map((batch) =>
      withRetries(
        "судья",
        (retryNote) =>
          buildJudgePrompt({
            hooks,
            candidates: batch.map(({ id, c }) => ({ id, hookId: c.hookId, text: c.text })),
            level: input.level,
            mode: input.mode,
            retryNote,
          }),
        deps.judge,
        (raw) => {
          const env = JudgeEnvelope.safeParse(raw);
          if (!env.success) return { ok: false, note: "ответ не по схеме: нужен объект scores" };
          // Только id этой пачки: чужой id (модель перенумеровала) перетёр бы оценку другой пачки.
          const own = new Set(batch.map(({ id }) => id));
          const byId = new Map<string, JudgeScores>();
          for (const item of env.data.scores) {
            const parsed = JudgeItem.safeParse(item);
            if (!parsed.success) continue;
            const { id, ...s } = parsed.data;
            if (own.has(id) && !byId.has(id)) byId.set(id, s);
          }
          if (byId.size === 0) {
            return {
              ok: false,
              note: "ни одной валидной оценки: нужны целые 0–5 по пяти критериям и id как во входе",
            };
          }
          return { ok: true, value: byId };
        },
      ),
    ),
  );
  const scores = new Map<string, JudgeScores>();
  for (const b of batches) for (const [id, s] of b) scores.set(id, s);

  const survivors: Scored[] = [];
  ids.forEach(({ id, c }, i) => {
    const s = scores.get(id);
    if (!s) {
      counters.unscored++;
      return;
    }
    if (s.aboutBehavior < thresholds.aboutBehavior || s.warmth < thresholds.warmth) {
      counters.droppedByJudge++;
      return;
    }
    survivors.push({
      hookId: c.hookId,
      order: orderBase + i,
      candidate: c,
      scores: s,
      total: totalScore(s),
    });
  });
  return survivors;
}

/**
 * Сборка (§5.5): сначала лучший кандидат каждого крючка («лучший из трёх»), затем остальные
 * выжившие по убыванию оценки, пока не набрано `max`. Итог отсортирован по оценке.
 */
export function assemble(pool: readonly Scored[], max: number): Scored[] {
  const better = (a: Scored, b: Scored) => b.total - a.total || a.order - b.order;
  const byHook = new Map<string, Scored[]>();
  for (const s of [...pool].sort(better)) {
    const group = byHook.get(s.hookId) ?? [];
    group.push(s);
    byHook.set(s.hookId, group);
  }
  const best: Scored[] = [];
  const rest: Scored[] = [];
  for (const group of byHook.values()) {
    const [first, ...others] = group;
    if (first) best.push(first);
    rest.push(...others);
  }
  best.sort(better);
  rest.sort(better);
  return [...best, ...rest].slice(0, max).sort(better);
}

/**
 * Шаг `write` без БД (roast-engine §5.2–§5.5): досье + факты → крючки → банк → писатель → судья.
 * Всё, что вернула модель, проходит проверку кодом до выдачи. Мало шуток после судьи: второй
 * раунд по другим крючкам (запасные), и если их всё равно меньше минимума уровня — `WriteFailedError`
 * (слабое не выдаём, §6 «Итог»). Перенесённые из Поджога шутки идут в начало списка.
 */
export async function writeCandidates(
  input: WriteInput,
  deps: WriteDeps = defaultWriteDeps(),
): Promise<WriteResult> {
  if (eligibleHooks(input.persona).length === 0) throw new WriteFailedError("no_hooks");

  const carried: CarriedPunch[] = input.carried ?? [];
  const maxNew = maxNewCandidates(input.tier);
  const minTotal = MIN_CANDIDATES_BY_LEVEL[input.level];
  const bank = await deps.loadBank(input.level);

  const counters: Counters = { written: 0, droppedInvalid: 0, droppedByJudge: 0, unscored: 0 };
  const seen = new Set(carried.map((p) => normalizeForDedupe(p.text)));
  const usedHooks = new Set<string>();
  const writtenTexts: string[] = [];
  const pool: Scored[] = [];
  let rounds = 0;
  let chosen: Scored[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // Запасной раунд берёт ещё не использованные крючки, а когда их нет, те же, но с запретом повторов.
    let hooks = selectHooks(input.persona, input.level, input.tier, usedHooks);
    if (hooks.length === 0) hooks = selectHooks(input.persona, input.level, input.tier);
    const styles = pickStyles(hooks, input.level, bank);

    rounds = round;
    const written = await writeRound(input, styles, writtenTexts, seen, counters, deps);
    for (const h of hooks) usedHooks.add(h.id);
    writtenTexts.push(...written.map((c) => c.text));

    pool.push(
      ...(await judgeRound(input, hooks, written, counters, deps, pool.length + 1000 * round)),
    );
    chosen = assemble(pool, maxNew);
    if (carried.length + chosen.length >= minTotal) break;
  }

  const stats: WriteStats = { rounds, ...counters };
  console.error(
    `[write] раундов=${rounds} написано=${stats.written} брак=${stats.droppedInvalid} судья_вырезал=${stats.droppedByJudge} без_оценки=${stats.unscored} итог=${chosen.length}+${carried.length}`,
  );
  if (carried.length + chosen.length < minTotal) {
    throw new WriteFailedError("not_enough_candidates");
  }

  const taken = new Set(carried.map((p) => p.id));
  const freshId = () => {
    for (let i = 0; i < 10; i++) {
      const id = deps.newId();
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
    throw new WriteFailedError("llm_failed");
  };
  const meta = {
    promptVersion: PROMPT_VERSION,
    writerModel: deps.models.writer,
    judgeModel: deps.models.judge,
  };

  return {
    promptVersion: PROMPT_VERSION,
    stats,
    candidates: [
      ...carried.map((p): WrittenCandidate => ({
        id: p.id,
        emoji: p.emoji,
        text: p.text,
        fromTrial: true,
        trace: p.trace,
      })),
      ...chosen.map((s): WrittenCandidate => ({
        id: freshId(),
        emoji: s.candidate.emoji,
        text: s.candidate.text,
        fromTrial: false,
        trace: {
          hookId: s.candidate.hookId,
          mechanism: s.candidate.mechanism,
          evidenceRef: s.candidate.evidenceRef,
          jokeCardId: s.candidate.jokeCardId,
          scores: s.scores,
          totalScore: s.total,
          ...meta,
        },
      })),
    ],
  };
}
