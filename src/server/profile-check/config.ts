/** Кэш результата проверки по нику: ok и отказ minor_detected. Тот же срок, что у снимка скрейпа. */
export const RESULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Потолок фоновой работы. Худший случай: скрейп 2 × 43 с + analyze 3 × 90 с ≈ 360 с, а `maxDuration`
 * маршрута 300 с (потолок Vercel на Hobby с Fluid compute). Поэтому ждём до 280 с и сами отвечаем
 * `internal`: пользователь видит отказ, а не бесконечный лоудер. На Pro `maxDuration` можно поднять
 * до 800 — тогда и этот потолок.
 */
export const MAX_DURATION_SECONDS = 300;
export const PIPELINE_DEADLINE_MS = 280_000;

/**
 * Проверка в `checking` дольше этого времени считается зависшей (функцию убили, фон не дописал):
 * GET помечает её `failed/internal`. Больше `maxDuration`, чтобы не обогнать живой фон.
 */
export const STALE_AFTER_MS = (MAX_DURATION_SECONDS + 30) * 1000;

/** Cookie владельца; ставим на год: дальше к ней привяжутся генерации и артефакты. */
export const OWNER_COOKIE = "ownerToken";
export const OWNER_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Тексты мини-лоудера: человеческими словами, без кодов и ответов провайдеров (инвариант 13). */
export const HINTS = {
  scrape: "Открываем профиль…",
  analyze: "Смотрим, можно ли жарить…",
} as const;
