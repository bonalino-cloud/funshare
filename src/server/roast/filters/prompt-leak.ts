import { buildWriterSystem, JUDGE_SYSTEM } from "../../prompts/roast/v1";
import { MODERATOR_SYSTEM } from "../../prompts/roast/moderator-v1";
import { MIN_CANARY_LENGTH, PROMPT_CANARIES, PROMPT_LEAK_CHAIN_WORDS } from "./config";
import { normalizedWords } from "./normalize";

// Утечка системного промпта через выход модели (roast-engine §8): недоверенные подписи из
// профиля могут уговорить модель процитировать свои инструкции. Два сигнала: canary-строка и
// длинная цепочка слов, совпадающая с нашим промптом.

/** Индекс: все цепочки из `chain` слов подряд в источниках. */
export type LeakIndex = { chain: number; grams: ReadonlySet<string> };

export function buildLeakIndex(
  sources: readonly string[],
  chain: number = PROMPT_LEAK_CHAIN_WORDS,
): LeakIndex {
  const grams = new Set<string>();
  for (const source of sources) {
    const words = normalizedWords(source);
    for (let i = 0; i + chain <= words.length; i++) grams.add(words.slice(i, i + chain).join(" "));
  }
  return { chain, grams };
}

/** Есть ли в тексте `chain` слов подряд из индекса. */
export function hasPromptChain(text: string, index: LeakIndex): boolean {
  if (index.grams.size === 0) return false;
  const words = normalizedWords(text);
  for (let i = 0; i + index.chain <= words.length; i++) {
    if (index.grams.has(words.slice(i, i + index.chain).join(" "))) return true;
  }
  return false;
}

/** Есть ли в тексте любая из canary-строк (без учёта регистра; слишком короткие игнорируются). */
export function hasCanary(text: string, canaries: readonly string[]): boolean {
  const lowered = text.toLowerCase();
  return canaries.some((c) => c.length >= MIN_CANARY_LENGTH && lowered.includes(c.toLowerCase()));
}

/**
 * Все системные промпты шагов `write`: писатель на всех степенях и режимах, судья, модератор.
 * Выпуск `v2` / `moderator-v2`: импорты здесь меняются вместе с `write-candidates.ts`, иначе
 * индекс останется на старом тексте и утечку нового промпта не поймает.
 */
export function promptSources(): string[] {
  const out: string[] = [JUDGE_SYSTEM, MODERATOR_SYSTEM];
  for (const level of ["rare", "medium", "well_done"] as const) {
    for (const mode of ["self", "friend"] as const) out.push(buildWriterSystem(level, mode));
  }
  return out;
}

let defaultIndex: LeakIndex | undefined;
/** Индекс по нашим промптам; строится при первом обращении. */
export function defaultLeakIndex(): LeakIndex {
  defaultIndex ??= buildLeakIndex(promptSources());
  return defaultIndex;
}

export function defaultCanaries(): readonly string[] {
  return PROMPT_CANARIES;
}
