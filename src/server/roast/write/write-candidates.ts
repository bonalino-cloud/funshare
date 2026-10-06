import { randomUUID } from "node:crypto";
import type { Level } from "@/contracts";
import {
  buildJudgePrompt,
  buildModeratorPrompt,
  buildWriterPrompt,
  MODERATOR_PROMPT_VERSION,
  promptHookId,
  ROAST_PROMPT_VERSION as PROMPT_VERSION,
} from "../../prompts/active";
import { LlmSchemaError } from "../../analyze/llm";
import { CostMeter } from "../../cost/meter";
import {
  bump,
  checkOutputText,
  defaultCanaries,
  defaultLeakIndex,
  emptyReport,
  hasCanary,
  hasPromptChain,
  formatReport,
  mergeCounts,
  totalCount,
  type Counts,
  type Layer4Code,
  type LeakIndex,
} from "../filters";
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
  MODERATION_MAX_PASSES,
  MODERATOR_CANDIDATES_PER_CALL,
  WRITER_HOOKS_PER_CALL,
} from "./config";
import { forbiddenTopics } from "../../analyze/forbidden";
import { eligibleHooks, overlapsForbidden, selectHooks } from "./hooks";
import {
  createAnthropicJudge,
  createAnthropicModerator,
  createAnthropicWriter,
  JUDGE_MODEL,
  MODERATOR_MODEL,
  WRITER_MODEL,
  type GenerateFn,
  type PromptText,
} from "./llm";
import { moderationReason } from "./moderate";
import {
  newEntry,
  setScores,
  setVerdict,
  TraceRecorder,
  type TraceEntry,
  type WriteTrace,
} from "./trace";
import {
  JudgeEnvelope,
  JudgeItem,
  ModeratorEnvelope,
  ModeratorItem,
  WriterCandidate,
  WriterEnvelope,
} from "./schema";
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
  /** LLM-модератор (слой 5): вердикты по кандидатам, которых увидит человек. */
  moderator: GenerateFn;
  /** Банк карточек уровня (одобренные, без красных линий в образцах). */
  loadBank: (level: Level) => Promise<BankCards>;
  models: { writer: string; judge: string; moderator: string };
  /** Canary-строки промптов для слоя 4 (задача 13). По умолчанию из `filters/config.ts`. */
  canaries?: readonly string[];
  /** Индекс цепочек слов промптов для слоя 4. По умолчанию по настоящим промптам. */
  leakIndex?: LeakIndex;
  /** Счётчик трат шага (токены всех вызовов, включая ретраи). Нет — учёта нет, поведение то же. */
  meter?: CostMeter;
  /** Идентификатор нового кандидата. Должен быть уникален; повтор при совпадении проверяет код. */
  newId: () => string;
};

/** Реальные реализации создаются лениво: сборка и тесты не требуют ключа и БД. */
export function defaultWriteDeps(): WriteDeps {
  const meter = new CostMeter();
  return {
    meter,
    writer: createAnthropicWriter(meter),
    judge: createAnthropicJudge(meter),
    moderator: createAnthropicModerator(meter),
    loadBank: async (level) => ({
      skeletons: await listCards({ level, kind: "skeleton" }),
      examples: await listCards({ level, kind: "example" }),
    }),
    models: { writer: WRITER_MODEL, judge: JUDGE_MODEL, moderator: MODERATOR_MODEL },
    newId: () => `p_${randomUUID().slice(0, 8)}`,
  };
}

export type WriteResult = {
  /** Сначала перенесённые из Поджога, затем новые по убыванию оценки судьи. */
  candidates: WrittenCandidate[];
  stats: WriteStats;
  promptVersion: string;
  /** Версия промпта и модель модератора: для `generation_traces` (задача 13). */
  moderator: { promptVersion: string; model: string };
  /** Приватная трасса запуска (`generation_traces`); `null`, если не прошла собственную схему. */
  trace: WriteTrace | null;
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

/** Кандидат как есть, без проверок кода: для трассы бракованного. `null`, если не по схеме. */
function looseCandidate(raw: unknown): Partial<ValidCandidate> | null {
  const parsed = WriterCandidate.safeParse(raw);
  if (!parsed.success) return null;
  return { mechanism: parsed.data.mechanism, emoji: parsed.data.emoji, text: parsed.data.text };
}

type RoundCandidate = ValidCandidate & { key: string; entry: TraceEntry };

type Scored = {
  hookId: string;
  order: number;
  candidate: ValidCandidate;
  entry: TraceEntry;
  scores: JudgeScores;
  total: number;
};

type Counters = Pick<
  WriteStats,
  | "written"
  | "droppedInvalid"
  | "droppedByJudge"
  | "unscored"
  | "droppedByModerator"
  | "unmoderated"
  | "filters"
>;

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
  rec: TraceRecorder,
): Promise<RoundCandidate[]> {
  const parts = await settleBatches(
    "писатель",
    chunk(styles, WRITER_HOOKS_PER_CALL).map((part) =>
      writeBatch(input, part, alreadyWritten, seen, counters, deps, rec),
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
  rec: TraceRecorder,
): Promise<RoundCandidate[]> {
  // Модель видит id после чистки промпта и отвечает им; сырой id тоже принимаем.
  const byHook = new Map<string, HookStyle>();
  for (const s of styles) byHook.set(promptHookId(s.hook.id), s).set(s.hook.id, s);
  const forbidden = forbiddenTopics(input.persona);
  const checkCtx = { level: input.level, canaries: deps.canaries, leakIndex: deps.leakIndex };
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
      const drops: Counts<Layer4Code> = {};
      const dropped: TraceEntry[] = [];
      const leaks = (text: string | undefined) =>
        text != null &&
        (hasCanary(text, deps.canaries ?? defaultCanaries()) ||
          hasPromptChain(text, deps.leakIndex ?? defaultLeakIndex()));
      const drop = (hookId: string, reason: Layer4Code, c: Partial<ValidCandidate> | null) => {
        bump(drops, reason);
        const entry = newEntry({
          round: rec.round,
          hookId,
          mechanism: c?.mechanism,
          jokeCardId: c?.jokeCardId,
          emoji: c?.emoji,
          // Кусок нашего промпта в БД не кладём: кандидата с утечкой храним без текста. Слой 4
          // видит только прошедших схему, поэтому брак (`unknown_hook`, `too_long` …) проверяем здесь.
          text: reason === "prompt_leak" || leaks(c?.text) ? null : c?.text,
          evidenceRef: c?.evidenceRef,
        });
        entry.outcome = "dropped_layer4";
        entry.reason = reason;
        dropped.push(entry);
      };
      const perHook = new Map<string, number>();
      for (const group of env.data.hooks) {
        const style = byHook.get(group.hookId);
        if (!style) {
          for (const raw of group.candidates) {
            drop(group.hookId, "unknown_hook", looseCandidate(raw));
          }
          continue;
        }
        for (const raw of group.candidates) {
          if ((perHook.get(style.hook.id) ?? 0) >= CANDIDATES_PER_HOOK) break;
          const v = validateCandidate(raw, style);
          if (!v.ok) {
            drop(style.hook.id, v.reason, looseCandidate(raw));
            continue;
          }
          // Слой 4 (§6): детерминированная проверка до судьи, чтобы не платить за брак.
          const outputReason = checkOutputText(v.value.text, checkCtx);
          if (outputReason) {
            drop(style.hook.id, outputReason, v.value);
            continue;
          }
          // Страховка кодом поверх промпта: запретная тема из досье в тексте вычёркивает шутку.
          if (overlapsForbidden(v.value.text, forbidden)) {
            drop(style.hook.id, "avoid_topic", v.value);
            continue;
          }
          const key = normalizeForDedupe(v.value.text);
          if (localSeen.has(key)) {
            drop(style.hook.id, "duplicate", v.value);
            continue;
          }
          localSeen.add(key);
          perHook.set(style.hook.id, (perHook.get(style.hook.id) ?? 0) + 1);
          out.push({ ...v.value, key, entry: newEntry({ round: rec.round, ...v.value }) });
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
      for (const e of dropped) rec.add(e);
      for (const c of out) rec.add(c.entry);
      counters.written += out.length;
      counters.droppedInvalid += totalCount(drops);
      mergeCounts(counters.filters.layer4, drops);
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
      c.entry.outcome = "unscored";
      return;
    }
    const total = totalScore(s);
    setScores(c.entry, s, total);
    if (s.aboutBehavior < thresholds.aboutBehavior || s.warmth < thresholds.warmth) {
      counters.droppedByJudge++;
      c.entry.outcome = "dropped_judge";
      c.entry.reason = s.aboutBehavior < thresholds.aboutBehavior ? "about_behavior" : "warmth";
      return;
    }
    survivors.push({
      hookId: c.hookId,
      order: orderBase + i,
      candidate: c,
      entry: c.entry,
      scores: s,
      total,
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
 * Модератор (слой 5, §6): один проход над `batch`, пачками по `MODERATOR_CANDIDATES_PER_CALL`.
 * Возвращает прошедших. Нет вердикта (пачка не получилась или модель пропустила id) — кандидат
 * отпадает: непроверенное человеку не показываем. Отпали все пачки — `llm_failed`, как у судьи.
 */
async function moderateBatch(
  input: WriteInput,
  forbidden: readonly string[],
  batch: readonly Scored[],
  counters: Counters,
  deps: WriteDeps,
): Promise<Scored[]> {
  const ids = batch.map((s, i) => ({ id: `m${i + 1}`, s }));
  const results = await settleBatches(
    "модератор",
    chunk(ids, MODERATOR_CANDIDATES_PER_CALL).map((part) =>
      withRetries(
        "модератор",
        (retryNote) =>
          buildModeratorPrompt({
            candidates: part.map(({ id, s }) => ({ id, text: s.candidate.text })),
            forbidden,
            level: input.level,
            mode: input.mode,
            retryNote,
          }),
        deps.moderator,
        (raw) => {
          const env = ModeratorEnvelope.safeParse(raw);
          if (!env.success) return { ok: false, note: "ответ не по схеме: нужен объект verdicts" };
          // Только id этой пачки и первый вердикт на id (как у судьи).
          const own = new Set(part.map(({ id }) => id));
          const byId = new Map<string, ModeratorItem>();
          for (const item of env.data.verdicts) {
            const parsed = ModeratorItem.safeParse(item);
            if (parsed.success && own.has(parsed.data.id) && !byId.has(parsed.data.id)) {
              byId.set(parsed.data.id, parsed.data);
            }
          }
          if (byId.size === 0) {
            return {
              ok: false,
              note: "ни одного валидного вердикта: нужны id как во входе и четыре поля true/false",
            };
          }
          return { ok: true, value: byId };
        },
      ),
    ),
  );
  const verdicts = new Map<string, ModeratorItem>();
  for (const r of results) for (const [id, v] of r) verdicts.set(id, v);

  const passed: Scored[] = [];
  for (const { id, s } of ids) {
    const verdict = verdicts.get(id);
    if (!verdict) {
      counters.unmoderated++;
      bump(counters.filters.layer5, "no_verdict");
      s.entry.outcome = "unmoderated";
      s.entry.reason = "no_verdict";
      continue;
    }
    setVerdict(s.entry, verdict);
    const reason = moderationReason(verdict);
    if (reason) {
      counters.droppedByModerator++;
      bump(counters.filters.layer5, reason);
      s.entry.outcome = "dropped_layer5";
      s.entry.reason = reason;
      continue;
    }
    passed.push(s);
  }
  return passed;
}

/**
 * Слой 5 с заменой: модерируем лучших по рейтингу судьи (`assemble`); вычеркнутых заменяют
 * следующие из запасных, пока не набрано `max` или не кончились проходы/запасные. Переписывание
 * не делаем: дешевле и не порождает непроверенный текст. Уже проверенных повторно не зовём.
 */
async function moderateToFill(
  input: WriteInput,
  forbidden: readonly string[],
  pool: readonly Scored[],
  approved: Scored[],
  moderated: Set<Scored>,
  max: number,
  counters: Counters,
  deps: WriteDeps,
): Promise<void> {
  for (let pass = 1; pass <= MODERATION_MAX_PASSES; pass++) {
    const need = max - approved.length;
    if (need <= 0) return;
    const batch = assemble(
      pool.filter((s) => !moderated.has(s)),
      need,
    );
    if (batch.length === 0) return;
    for (const s of batch) moderated.add(s);
    counters.filters.moderatorChecked += batch.length;
    counters.filters.moderatorPasses++;
    try {
      approved.push(...(await moderateBatch(input, forbidden, batch, counters, deps)));
    } catch (error) {
      // Модератор лёг целиком, но одобренные уже есть: не теряем их, хватит ли — решит минимум.
      if (!(error instanceof WriteFailedError) || approved.length === 0) throw error;
      counters.unmoderated += batch.length;
      bump(counters.filters.layer5, "no_verdict", batch.length);
      for (const s of batch) {
        s.entry.outcome = "unmoderated";
        s.entry.reason = "no_verdict";
      }
      return;
    }
  }
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
  const rec = new TraceRecorder({
    level: input.level,
    mode: input.mode,
    tier: input.tier,
    prompts: {
      writer: PROMPT_VERSION,
      judge: PROMPT_VERSION,
      moderator: MODERATOR_PROMPT_VERSION,
    },
    models: deps.models,
  });
  try {
    return await writeWithTrace(input, deps, rec);
  } catch (error) {
    // Провал шага самый интересный для разбора: трасса едет к вызывающему вместе с ошибкой.
    if (error instanceof WriteFailedError) {
      error.trace = rec.build({ result: "failed", failure: error.reason });
    }
    throw error;
  }
}

async function writeWithTrace(
  input: WriteInput,
  deps: WriteDeps,
  rec: TraceRecorder,
): Promise<WriteResult> {
  if (eligibleHooks(input.persona).length === 0) throw new WriteFailedError("no_hooks");

  const carried: CarriedPunch[] = input.carried ?? [];
  const maxNew = maxNewCandidates(input.tier);
  const minTotal = MIN_CANDIDATES_BY_LEVEL[input.level];
  const bank = await deps.loadBank(input.level);

  const counters: Counters = {
    written: 0,
    droppedInvalid: 0,
    droppedByJudge: 0,
    unscored: 0,
    droppedByModerator: 0,
    unmoderated: 0,
    filters: emptyReport(),
  };
  rec.counters = counters;
  rec.carriedPunchIds = carried.map((p) => p.id);
  const forbidden = forbiddenTopics(input.persona);
  const seen = new Set(carried.map((p) => normalizeForDedupe(p.text)));
  const usedHooks = new Set<string>();
  const writtenTexts: string[] = [];
  const pool: Scored[] = [];
  // Прошедшие модератора и уже отданные ему: раунд 2 не гоняет проверенных повторно.
  const approved: Scored[] = [];
  const moderated = new Set<Scored>();
  let rounds = 0;
  let chosen: Scored[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // Запасной раунд берёт ещё не использованные крючки, а когда их нет, те же, но с запретом повторов.
    let hooks = selectHooks(input.persona, input.level, input.tier, usedHooks);
    if (hooks.length === 0) hooks = selectHooks(input.persona, input.level, input.tier);
    const styles = pickStyles(hooks, input.level, bank);

    rounds = round;
    rec.round = round;
    rec.addRound(
      round,
      hooks.map((h) => h.id),
    );
    const written = await writeRound(input, styles, writtenTexts, seen, counters, deps, rec);
    for (const h of hooks) usedHooks.add(h.id);
    writtenTexts.push(...written.map((c) => c.text));

    pool.push(
      ...(await judgeRound(input, hooks, written, counters, deps, pool.length + 1000 * round)),
    );
    await moderateToFill(input, forbidden, pool, approved, moderated, maxNew, counters, deps);
    chosen = assemble(approved, maxNew);
    if (carried.length + chosen.length >= minTotal) break;
  }

  const stats: WriteStats = { rounds, ...counters };
  // Одна строка на генерацию: только коды и числа, без текстов шуток и профиля.
  console.error(
    `[write] раундов=${rounds} написано=${stats.written} брак=${stats.droppedInvalid} судья_вырезал=${stats.droppedByJudge} без_оценки=${stats.unscored} модератор_вырезал=${stats.droppedByModerator} без_вердикта=${stats.unmoderated} ${formatReport(stats.filters)} итог=${chosen.length}+${carried.length}`,
  );
  if (carried.length + chosen.length < minTotal) {
    throw new WriteFailedError("not_enough_candidates");
  }

  const taken = new Set(carried.map((p) => p.id));
  const freshId = (entry: TraceEntry) => {
    for (let i = 0; i < 10; i++) {
      const id = deps.newId();
      if (!taken.has(id)) {
        taken.add(id);
        entry.outcome = "chosen";
        entry.punchId = id;
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

  const result: WriteResult = {
    promptVersion: PROMPT_VERSION,
    moderator: { promptVersion: MODERATOR_PROMPT_VERSION, model: deps.models.moderator },
    stats,
    trace: null,
    candidates: [
      ...carried.map((p): WrittenCandidate => ({
        id: p.id,
        emoji: p.emoji,
        text: p.text,
        fromTrial: true,
        trace: p.trace,
      })),
      ...chosen.map((s): WrittenCandidate => ({
        id: freshId(s.entry),
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
  // После сборки списка: `chosen` и `punchId` в записях проставлены при выдаче id.
  result.trace = rec.build({ result: "ok" });
  return result;
}
