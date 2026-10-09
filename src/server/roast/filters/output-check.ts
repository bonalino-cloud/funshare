import type { Level } from "@/contracts";
import {
  defaultCanaries,
  defaultLeakIndex,
  hasCanary,
  hasPromptChain,
  type LeakIndex,
} from "./prompt-leak";
import {
  BANNED_WORDS,
  forbiddenCategories,
  HEDGES,
  PROFANITY_AFTER_PREFIX,
  PROFANITY_CONTAINS,
  PROFANITY_EXACT,
  PROFANITY_PREFIXES,
  PROFANITY_STARTS,
  TOPIC_LEXICON,
  type Lexeme,
  type TopicCategory,
} from "./lexicon";
import { normalizedWords, paddedNormalized } from "./normalize";

// Слой 4 (roast-engine §6): детерминированная проверка текста шутки. Чистые функции, без
// БД и сети. Длина, язык и дубли проверяются в `write/candidate.ts` и не повторяются здесь.

/** Причина вычёркивания: код, не текст. Идёт в счётчики и логи. */
export type OutputReason =
  "prompt_leak" | "long_dash" | "hedging" | "banned_word" | "profanity" | `topic_${TopicCategory}`;

export type OutputCheckContext = {
  level: Level;
  /** Canary-строки промптов (задача 13). По умолчанию из `config.ts`. */
  canaries?: readonly string[];
  /** Индекс цепочек слов наших промптов. По умолчанию строится по настоящим промптам. */
  leakIndex?: LeakIndex;
};

function matchesLexeme(words: readonly string[], padded: string, lex: Lexeme): boolean {
  const exact = lex.exact ? new Set(lex.exact) : undefined;
  for (const w of words) {
    if (exact?.has(w)) return true;
    if (!lex.stems?.some((s) => w.startsWith(s))) continue;
    if (lex.except?.some((e) => w.startsWith(e))) continue;
    return true;
  }
  return lex.phrases?.some((p) => padded.includes(` ${p} `)) ?? false;
}

const prefixAlternation = [...PROFANITY_PREFIXES].sort((a, b) => b.length - a.length).join("|");
const PROFANITY_PREFIXED = new RegExp(
  `^(?:${prefixAlternation})*(?:${PROFANITY_AFTER_PREFIX.join("|")})`,
);
const PROFANITY_EXACT_SET = new Set(PROFANITY_EXACT);

export function hasProfanity(text: string): boolean {
  return normalizedWords(text).some(
    (w) =>
      PROFANITY_EXACT_SET.has(w) ||
      PROFANITY_CONTAINS.some((root) => w.includes(root)) ||
      PROFANITY_STARTS.some((root) => w.startsWith(root)) ||
      PROFANITY_PREFIXED.test(w),
  );
}

/**
 * Длинное тире запрещено tone-of-voice §3 «Знаки»: «—», «―», «--» и «–» вне диапазона цифр
 * (3–5). Обычный дефис, в том числе с пробелами, не трогаем: это не длинное тире.
 */
export function hasLongDash(text: string): boolean {
  return /[—―–]|--/.test(text.replace(/(?<=\d)–(?=\d)/g, ""));
}

/** Какие запретные темы задевает текст на этой степени (пусто — ни одной). */
export function topicHits(text: string, level: Level): TopicCategory[] {
  const words = normalizedWords(text);
  const padded = paddedNormalized(text);
  return forbiddenCategories(level).filter((c) => matchesLexeme(words, padded, TOPIC_LEXICON[c]));
}

/** Первая найденная причина вычёркивания или `null`, если текст чист. */
export function checkOutputText(text: string, ctx: OutputCheckContext): OutputReason | null {
  const canaries = ctx.canaries ?? defaultCanaries();
  if (hasCanary(text, canaries) || hasPromptChain(text, ctx.leakIndex ?? defaultLeakIndex())) {
    return "prompt_leak";
  }
  if (hasLongDash(text)) return "long_dash";
  const words = normalizedWords(text);
  const padded = paddedNormalized(text);
  if (matchesLexeme(words, padded, HEDGES)) return "hedging";
  if (matchesLexeme(words, padded, BANNED_WORDS)) return "banned_word";
  if (ctx.level !== "well_done" && hasProfanity(text)) return "profanity";
  const [topic] = topicHits(text, ctx.level);
  return topic ? `topic_${topic}` : null;
}
