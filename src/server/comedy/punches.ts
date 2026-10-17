import { PUNCH_MAX_CHARS } from "@/contracts";
import { STOPWORDS } from "../facts/stopwords";
import { sanitizeText } from "../facts/text";
import { buildPunchPrompt } from "../prompts/comedy/punch-v1";
import {
  bump,
  checkOutputText,
  defaultCanaries,
  defaultLeakIndex,
  hasCanary,
  hasPromptChain,
  mergeCounts,
  totalCount,
  type Counts,
  type Layer4Code,
} from "../roast/filters";
import {
  cleanEmoji,
  cyrillicShare,
  normalizeForDedupe,
  type Rejection,
} from "../roast/write/candidate";
import { MIN_CYRILLIC_SHARE } from "../roast/write/config";
import { PUNCH_INSIGHTS_PER_CALL, PUNCHES_PER_INSIGHT } from "./config";
import { normalizeRefId } from "./insights";
import { chunk, settleBatches, withRetries } from "./retry";
import { PunchEnvelope, PunchItem, type Insight, type Structure } from "./schema";
import type { Candidate, RunContext } from "./state";
import { newComedyEntry, type ComedyTraceEntry } from "./trace";

// Шаг 3 (comedy-engine §7.4): по 3 шутки на инсайт, пачками по 3 инсайта параллельно. Каждая
// шутка проверяется кодом (§3): инсайт из пачки, длина ≤ PUNCH_MAX_CHARS, кириллица ≥ 0.6,
// эмодзи через `cleanEmoji`, слой 4 (`checkOutputText`, well done), дефис с пробелами вместо тире,
// тяжёлое событие досье (две основы одного события, `sensitive_event`), дубль по нормализованному
// тексту (с выбранными в Поджоге тоже). Темы `avoidTopics` код по основам НЕ проверяет: основы
// ловили весь бизнес героя («аренд», «ланке»); они уходят в промпты и модератору.

/**
 * Дефис с пробелами вместо тире («факт - вывод»): `punch-v1` его запрещает, а общий слой 4
 * (`hasLongDash`) обычный дефис не трогает, чтобы не менять старый путь. Режем только у comedy:
 * между словами, без цифр по краям («5 - 7» остаётся).
 */
const SPACED_HYPHEN = /(?<=[^\s\d])[ \t]+-[ \t]+(?=[^\s\d])/u;

export function hasSpacedHyphen(text: string): boolean {
  return SPACED_HYPHEN.test(text);
}

/** Слово или составное имя через дефис («Санкт-Петербург», «Шри-Ланке», «из-за»). */
const TOKEN = /[\p{L}\p{N}]+(?:[-\u2010\u2011][\p{L}\p{N}]+)*/gu;
const HYPHEN = /[-\u2010\u2011]/u;
/** Основа — первые 5 букв, как в `overlapsForbidden` старого пути. */
const STEM = 5;
const MIN_WORD = 4;
/**
 * Гласные, «й» и «ь» на конце срезаются до основы: у коротких слов окончание попадает в первые
 * 5 букв («Ланка / Ланке / Ланку», «мама / мамы», «Киев / Киева» — одна основа). Корень короче
 * 3 букв не режем («моей»).
 */
const VOWEL_TAIL = /[аеиоуыэюяйь]+$/u;
const MIN_ROOT = 3;
/**
 * Частые слова, которые событие не опознают, их основы не считаются: «в 2023 году» — одна дата,
 * а не две основы; «новая жизнь», «сложное время» есть в каждой второй шутке.
 */
const VAGUE_STEMS: ReadonlySet<string> = new Set([
  ...["год", "годом", "годам", "годах"],
  ...["нов", "новог", "новом", "новым", "новых"],
  ...["жизн", "врем", "време"],
]);
/** Столько разных основ одного события должно совпасть, чтобы шутка считалась про него. */
const SENSITIVE_STEMS_TO_HIT = 2;

function stemOf(word: string): string {
  const root = word.replace(VOWEL_TAIL, "");
  return (root.length >= MIN_ROOT ? root : word).slice(0, STEM);
}

/**
 * Основы текста группами: одно слово — группа из одной основы, составное имя через дефис —
 * одна группа из основ своих частей («Санкт-Петербург» — одно имя, а не две основы).
 * Части короче 4 букв и стоп-слова не считаются («Шри-Ланке» = «ланк», «из-за» пусто).
 */
function stemGroups(text: string): string[][] {
  const tokens = text.toLowerCase().replace(/ё/g, "е").match(TOKEN) ?? [];
  return tokens
    .map((token) =>
      token
        .split(HYPHEN)
        .filter((w) => w.length >= MIN_WORD && !STOPWORDS.has(w))
        .map(stemOf)
        .filter((s) => !VAGUE_STEMS.has(s)),
    )
    .filter((group) => group.length > 0);
}

/** Сколько разных групп события нашлось в тексте; группа с уже засчитанной основой — повтор. */
function sharedGroups(own: ReadonlySet<string>, event: string): number {
  const counted = new Set<string>();
  let shared = 0;
  for (const group of stemGroups(event)) {
    if (!group.some((s) => own.has(s)) || group.some((s) => counted.has(s))) continue;
    for (const s of group) counted.add(s);
    shared++;
  }
  return shared;
}

/**
 * Шутка про тяжёлое событие досье (`sensitiveEvents`): по одному событию совпали хотя бы две
 * разные основы. Красная линия держится кодом, а не только моделями. Одна основа не режет:
 * событие «бедствие на Шри-Ланке» и шутка «свой человек на Шри-Ланке» (общая только «ланк»)
 * про бизнес героя, а не про бедствие. Повтор слова и составное имя через дефис — одна основа.
 * `avoidTopics` код не проверяет: там темы, а не события, основы ловили весь бизнес героя.
 */
export function hitsSensitiveEvent(text: string, events: readonly string[]): boolean {
  const own = new Set(stemGroups(text).flat());
  return events.some((event) => sharedGroups(own, event) >= SENSITIVE_STEMS_TO_HIT);
}

export type ValidPunch = { insightId: string; structure: Structure; emoji: string; text: string };

export function validatePunch(
  raw: unknown,
  byId: ReadonlyMap<string, Insight>,
): { ok: true; value: ValidPunch } | { ok: false; reason: Rejection } {
  const parsed = PunchItem.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "bad_shape" };
  const p = parsed.data;
  const insight = byId.get(normalizeRefId(p.insightId));
  if (!insight) return { ok: false, reason: "unknown_hook" };
  const text = sanitizeText(p.text);
  if (text === "") return { ok: false, reason: "empty" };
  // Контракт считает единицы UTF-16 (`z.string().max`): так же и здесь.
  if (text.length > PUNCH_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (cyrillicShare(text) < MIN_CYRILLIC_SHARE) return { ok: false, reason: "not_russian" };
  return {
    ok: true,
    value: { insightId: insight.id, structure: p.structure, emoji: cleanEmoji(p.emoji), text },
  };
}

/** Шутка как есть, без проверок: для трассы брака. `null`, если не по схеме. */
function loosePunch(raw: unknown): { structure: Structure; emoji: string; text: string } | null {
  const parsed = PunchItem.safeParse(raw);
  return parsed.success
    ? { structure: parsed.data.structure, emoji: parsed.data.emoji, text: parsed.data.text }
    : null;
}

type BatchResult = {
  accepted: Candidate[];
  dropped: ComedyTraceEntry[];
  drops: Counts<Layer4Code>;
};

function parseBatch(
  raw: unknown,
  insights: readonly Insight[],
  seen: ReadonlySet<string>,
  round: number,
  ctx: RunContext,
): BatchResult | null {
  const env = PunchEnvelope.safeParse(raw);
  if (!env.success) return null;
  const byId = new Map(insights.map((i) => [i.id, i]));
  const { canaries, leakIndex } = ctx.deps;
  const leaks = (text: string | undefined) =>
    text != null &&
    (hasCanary(text, canaries ?? defaultCanaries()) ||
      hasPromptChain(text, leakIndex ?? defaultLeakIndex()));
  const checkCtx = { level: ctx.level, canaries, leakIndex };
  const localSeen = new Set(seen);
  const perInsight = new Map<string, number>();
  const result: BatchResult = { accepted: [], dropped: [], drops: {} };

  const drop = (insightId: string, reason: Layer4Code, p: Partial<ValidPunch> | null) => {
    bump(result.drops, reason);
    const entry = newComedyEntry({
      round,
      insightId,
      structure: p?.structure,
      emoji: p?.emoji,
      // Кусок нашего промпта в БД не кладём: кандидата с утечкой храним без текста.
      text: reason === "prompt_leak" || leaks(p?.text) ? null : p?.text,
    });
    result.dropped.push({ ...entry, outcome: "dropped_layer4", reason });
  };

  for (const raw of env.data.punches) {
    const v = validatePunch(raw, byId);
    if (!v.ok) {
      const loose = loosePunch(raw);
      const id =
        raw && typeof raw === "object" && "insightId" in raw
          ? sanitizeText(String(raw.insightId)) || "?"
          : "?";
      drop(id, v.reason, loose);
      continue;
    }
    const p = v.value;
    // Лишние сверх трёх на инсайт молча отбрасываются (как в `write`).
    if ((perInsight.get(p.insightId) ?? 0) >= PUNCHES_PER_INSIGHT) continue;
    const reason = checkOutputText(p.text, checkCtx);
    if (reason) {
      drop(p.insightId, reason, p);
      continue;
    }
    if (hasSpacedHyphen(p.text)) {
      drop(p.insightId, "spaced_hyphen", p);
      continue;
    }
    if (hitsSensitiveEvent(p.text, ctx.sensitiveEvents)) {
      drop(p.insightId, "sensitive_event", p);
      continue;
    }
    const key = normalizeForDedupe(p.text);
    if (localSeen.has(key)) {
      drop(p.insightId, "duplicate", p);
      continue;
    }
    localSeen.add(key);
    perInsight.set(p.insightId, (perInsight.get(p.insightId) ?? 0) + 1);
    result.accepted.push({
      ...p,
      round,
      key,
      entry: newComedyEntry({ round, ...p }),
      scores: null,
      total: null,
      dupOf: null,
    });
  }
  return result;
}

/** Минимум годных шуток на инсайт пачки: меньше — пачка повторяется. */
const MIN_PUNCHES_PER_INSIGHT = 2;

/** Инсайты пачки, у которых годных шуток меньше `MIN_PUNCHES_PER_INSIGHT`. */
export function shortInsights(
  insights: readonly Insight[],
  accepted: readonly { insightId: string }[],
): string[] {
  return insights
    .filter((i) => accepted.filter((c) => c.insightId === i.id).length < MIN_PUNCHES_PER_INSIGHT)
    .map((i) => i.id);
}

async function punchBatch(
  insights: readonly Insight[],
  alreadyWritten: readonly string[],
  seen: Set<string>,
  round: number,
  ctx: RunContext,
): Promise<Candidate[]> {
  return withRetries(
    "генератор",
    ({ retryNote }) =>
      buildPunchPrompt({
        profile: ctx.profile,
        insights,
        mode: ctx.mode,
        forbidden: ctx.forbidden,
        delicate: ctx.delicate,
        alreadyWritten,
        perInsight: PUNCHES_PER_INSIGHT,
        retryNote,
      }),
    ctx.deps.punch,
    (raw, { lastAttempt }) => {
      const r = parseBatch(raw, insights, seen, round, ctx);
      if (!r) return { ok: false, note: "ответ не по схеме: нужен объект punches" };
      if (r.accepted.length === 0) {
        return {
          ok: false,
          note: `ни одна шутка не принята: русский язык, до ${PUNCH_MAX_CHARS} знаков, без длинного тире, insightId как во входе`,
        };
      }
      // Модель иногда рано закрывает массив: меньше двух годных шуток на инсайт — повтор пачки.
      // На последней попытке принимаем, что есть.
      const short = shortInsights(insights, r.accepted);
      if (short.length > 0 && !lastAttempt) {
        return {
          ok: false,
          note: `На каждый инсайт ровно ${PUNCHES_PER_INSIGHT} шутки; не хватает для: ${short.join(", ")}.`,
        };
      }
      // Принятое запоминаем только при успехе попытки: неудачная не должна занять тексты.
      for (const c of r.accepted) seen.add(c.key);
      for (const e of r.dropped) ctx.rec.add(e);
      for (const c of r.accepted) ctx.rec.add(c.entry);
      ctx.counters.written += r.accepted.length;
      ctx.counters.droppedInvalid += totalCount(r.drops);
      mergeCounts(ctx.counters.filters.layer4, r.drops);
      return { ok: true, value: r.accepted };
    },
  );
}

/** Все инсайты раунда пачками по `PUNCH_INSIGHTS_PER_CALL`, пачки параллельно. */
export async function writePunches(
  insights: readonly Insight[],
  alreadyWritten: readonly string[],
  seen: Set<string>,
  round: number,
  ctx: RunContext,
): Promise<Candidate[]> {
  const parts = await settleBatches(
    "генератор",
    chunk(insights, PUNCH_INSIGHTS_PER_CALL).map((part) =>
      punchBatch(part, alreadyWritten, seen, round, ctx),
    ),
  );
  return parts.flat();
}
