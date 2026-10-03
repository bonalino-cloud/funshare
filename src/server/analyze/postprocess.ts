import type { ProfileSnapshot } from "@/contracts";
import { ObservationEvidence, PersonaProfile } from "@/contracts";
import type { ProfileFacts } from "../facts";
import { capCodepoints, cleanUntrusted, sanitizeText } from "../facts/text";
import { httpUrl, type Cover } from "./covers";
import type { LlmDossier } from "./schema";

// Всё, что код делает с ответом модели ДО строгого `PersonaProfile.parse` (инвариант 9):
// чистка текста, проверка evidence, id, лимиты контракта. Ответ модели — чужой контент:
// он дальше читается шагом `write`, поэтому тоже проходит `sanitizeText`.

const OBSERVATIONS_MAX = 14;
const EVIDENCE_MAX = 10;
const LINE_CAP = 200;
const SUMMARY_CAP = 500;
const LOOK_CAP = 600;
const LOOK_REFERENCES_MAX = 4;
const LOOK_PICKS_MAX = 3;

/** Счётчики вычеркнутого: идут в лог (метрика качества промпта), текста там нет. */
export type DropStats = {
  unsafe: number;
  noEvidence: number;
  duplicates: number;
  overLimit: number;
  evidenceRefsDropped: number;
};

export type PostprocessContext = {
  snapshot: ProfileSnapshot;
  facts: ProfileFacts;
  /** Обложки, реально отправленные модели в этой попытке. */
  covers: readonly Cover[];
};

/**
 * Текст модели и имя профиля → досье. Модель читает и картинки (текст на фото PII-чистку не
 * проходил), а досье дальше уходит в публичный артефакт: тот же `cleanUntrusted`, что у подписей.
 */
function clean(text: string, cap: number): string {
  return capCodepoints(cleanUntrusted(text).text, cap);
}

/** Очистка, пустые убираем, дубли без учёта регистра убираем, режем до лимита контракта. */
function cleanList(items: readonly string[], max: number, cap = LINE_CAP): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = clean(item, cap);
    const key = text.toLowerCase();
    if (text === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

const REPEAT_KIND = /^fact:(hashtag|location|word):/;
const REPEAT_REF = /^fact:(hashtag|location|word):(.+)=(\d+)$/;

/**
 * Ссылка на повтор из ProfileFacts должна совпасть с ним по значению и по счёту: цифру в шутке
 * считает код, а не модель (roast-engine.md §0, решение 2). Прочие `fact:*` — `computedRefOk`.
 */
function repeatRefOk(ref: string, facts: ProfileFacts): boolean {
  const m = REPEAT_REF.exec(ref);
  if (!m) return false; // повтор без «=число» не принимаем
  const [, kind, rawValue, rawCount] = m;
  const value = (rawValue ?? "").trim().replace(/^#/, "").toLowerCase();
  const count = Number(rawCount);
  const list =
    kind === "hashtag"
      ? facts.repeats.hashtags.map((x) => [x.tag, x.count] as const)
      : kind === "location"
        ? facts.repeats.locations.map((x) => [x.name, x.count] as const)
        : facts.repeats.words.map((x) => [x.word, x.count] as const);
  return list.some(([key, c]) => key.toLowerCase() === value && c === count);
}

/** Число модели совпадает с посчитанным кодом с точностью до записанных ею знаков. */
function sameNumber(written: string, actual: number): boolean {
  if (!/^-?\d+(?:\.\d+)?$/.test(written)) return false;
  const decimals = written.split(".")[1]?.length ?? 0;
  return Math.abs(Number(written) - actual) <= 0.5 * 10 ** -decimals + 1e-9;
}

function samePrimitive(written: string, actual: unknown): boolean {
  if (typeof actual === "number") return sameNumber(written.trim(), actual);
  if (typeof actual === "boolean") return written.trim().toLowerCase() === String(actual);
  if (typeof actual === "string") return written.trim().toLowerCase() === actual.toLowerCase();
  return false; // null, объекты, массивы: сверять не с чем
}

/**
 * Прочие `fact:*` (статистика, ритм, язык) сверяются с ProfileFacts так же, как повторы:
 * `fact:<блок>:<поле>=<значение>` или `fact:<поле>:<значение>` для полей верхнего уровня.
 * Цифру считает код (roast-engine.md §0, решение 2): выдуманное или неизвестное поле не принимаем.
 */
function computedRefOk(ref: string, facts: ProfileFacts): boolean {
  const m = /^fact:([A-Za-z]+):(.+)$/.exec(ref);
  if (!m) return false;
  const [, kind = "", rest = ""] = m;
  if (kind === "repeats" || kind === "captionsForLlm") return false;
  const node: unknown = (facts as Record<string, unknown>)[kind];
  if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    const eq = rest.indexOf("=");
    if (eq <= 0) return false;
    const key = rest.slice(0, eq).trim();
    if (!Object.hasOwn(node, key)) return false;
    return samePrimitive(rest.slice(eq + 1), (node as Record<string, unknown>)[key]);
  }
  return samePrimitive(rest.replace(/^=/, ""), node);
}

/** Оставляет только проверяемые ссылки: формат контракта, существующий пост, реальный повтор. */
function validEvidence(
  raw: readonly string[],
  ctx: PostprocessContext,
  stats: DropStats,
): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const cleaned = sanitizeText(item);
    const post = /^post:(\d+)$/.exec(cleaned);
    // `post:03` и `post:3` — один пост: храним каноничную форму, иначе `write` и дедуп их различают.
    const ref = post ? `post:${Number(post[1])}` : cleaned;
    const ok =
      ObservationEvidence.safeParse(cleaned).success &&
      (post
        ? Number(post[1]) < ctx.snapshot.posts.length
        : REPEAT_KIND.test(ref)
          ? repeatRefOk(ref, ctx.facts)
          : computedRefOk(ref, ctx.facts));
    if (!ok) stats.evidenceRefsDropped += 1;
    else if (!out.includes(ref)) out.push(ref);
    if (out.length >= EVIDENCE_MAX) break;
  }
  return out;
}

function buildLook(draft: LlmDossier["look"], ctx: PostprocessContext) {
  if (!draft) return null;
  const description = clean(draft.description, LOOK_CAP);
  if (description === "") return null;
  const byIndex = new Map(ctx.covers.map((c) => [c.index, c.url]));
  const urls: string[] = [];
  const avatar = httpUrl(ctx.snapshot.avatarUrl);
  if (avatar) urls.push(avatar);
  let picks = 0;
  for (const index of draft.referenceIndexes) {
    const url = byIndex.get(index);
    if (url && !urls.includes(url) && picks < LOOK_PICKS_MAX) {
      urls.push(url);
      picks += 1;
    }
  }
  // Аватар модели не показывается: описание опирается только на присланные обложки. Ни одна не
  // выбрана (или обложек не было) — описание выдумано по тексту, рисовать по нему героя нельзя.
  if (picks === 0) return null;
  return { description, referenceImageUrls: urls.slice(0, LOOK_REFERENCES_MAX) };
}

function buildObservations(draft: LlmDossier["observations"], ctx: PostprocessContext) {
  const stats: DropStats = {
    unsafe: 0,
    noEvidence: 0,
    duplicates: 0,
    overLimit: 0,
    evidenceRefsDropped: 0,
  };
  const seenClaims = new Set<string>();
  const kept: { claim: string; evidence: string[]; recognizability: number; safe: true }[] = [];

  for (const item of draft) {
    if (!item.safe) {
      stats.unsafe += 1;
      continue;
    }
    const claim = clean(item.claim, LINE_CAP);
    const evidence = validEvidence(item.evidence, ctx, stats);
    // Правило досье №1: без опоры на пост или цифру наблюдения нет.
    if (claim === "" || evidence.length === 0) {
      stats.noEvidence += 1;
      continue;
    }
    const key = claim.toLowerCase();
    if (seenClaims.has(key)) {
      stats.duplicates += 1;
      continue;
    }
    seenClaims.add(key);
    const rounded = Math.round(item.recognizability);
    const recognizability = Number.isFinite(rounded) ? Math.min(5, Math.max(1, rounded)) : 3;
    kept.push({ claim, evidence, recognizability, safe: true });
  }

  // Сначала самые узнаваемые (сортировка устойчивая), затем лимит контракта.
  kept.sort((a, b) => b.recognizability - a.recognizability);
  stats.overLimit = Math.max(0, kept.length - OBSERVATIONS_MAX);
  // id проставляет код: уникальность не просим у модели (комментарий в persona.ts).
  const observations = kept.slice(0, OBSERVATIONS_MAX).map((o, i) => ({ id: `o${i + 1}`, ...o }));
  return { observations, stats };
}

/**
 * Ответ модели → кандидат `PersonaProfile` → строгий parse. `isPrivate` берётся из снимка,
 * `username` и `displayName` тоже: модель их не придумывает.
 */
export function buildPersona(draft: LlmDossier, ctx: PostprocessContext) {
  const { observations, stats } = buildObservations(draft.observations, ctx);
  const language = draft.language.trim().toLowerCase();

  const candidate = {
    username: ctx.snapshot.username,
    displayName: clean(ctx.snapshot.fullName, 100) || ctx.snapshot.username,
    language: /^[a-z]{2}$/.test(language) ? language : (ctx.facts.language.code ?? "ru"),
    summary: clean(draft.summary, SUMMARY_CAP),
    vibe: clean(draft.vibe, LINE_CAP),
    traits: cleanList(draft.traits, 10, 60),
    interests: cleanList(draft.interests, 10, 80),
    habits: cleanList(draft.habits, 10),
    aesthetics: clean(draft.aesthetics, LINE_CAP),
    humorAngles: cleanList(draft.humorAngles, 10),
    avoidTopics: cleanList(draft.avoidTopics, 10),
    look: buildLook(draft.look, ctx),
    observations,
    warmFacts: cleanList(draft.warmFacts, 5),
    signatureMoves: cleanList(draft.signatureMoves, 10),
    sensitiveEvents: cleanList(draft.sensitiveEvents, 10),
    flags: {
      isPrivate: ctx.snapshot.isPrivate,
      likelyMinor: draft.flags.likelyMinor,
      insufficientData: draft.flags.insufficientData,
    },
  };

  return { result: PersonaProfile.safeParse(candidate), stats };
}
