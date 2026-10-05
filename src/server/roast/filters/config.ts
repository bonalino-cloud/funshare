import { ALL_CANARIES } from "../../prompts/canary";

// Настройки слоя 4 (roast-engine §6, §8).

/**
 * Canary-строки системных промптов (`prompts/canary.ts`): уникальная строка в системном промпте,
 * чьё появление в выходе модели означает утечку. Работает вместе с проверкой по цепочке слов
 * (`PROMPT_LEAK_CHAIN_WORDS`).
 */
export const PROMPT_CANARIES: readonly string[] = ALL_CANARIES;

/** Короче строка не считается canary: пустая или короткая находилась бы в любом тексте. */
export const MIN_CANARY_LENGTH = 6;

/** Столько слов подряд, совпавших с нашим промптом, считаются утечкой промпта. */
export const PROMPT_LEAK_CHAIN_WORDS = 8;
