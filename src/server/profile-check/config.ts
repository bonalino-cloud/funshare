/** Кэш результата проверки по нику: ok и отказ minor_detected. Тот же срок, что у снимка скрейпа. */
export const RESULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Потолки фоновой работы (`after` живёт в пределах `maxDuration` маршрута, 300 с на Hobby с Fluid
 * compute; на Pro можно поднять до 800 — тогда и потолки).
 * - Сама проверка (скрейп 2 × 43 с + аватар 8 с ≈ 94 с): 120 с, дальше отвечаем `internal`.
 * - Вся фоновая работа вместе с досье (analyze: 3 попытки до 90 с): 280 с от старта. Досье не успело —
 *   его дорешает старт генерации, замок в `dossier_runs` не даёт заплатить дважды.
 */
export const MAX_DURATION_SECONDS = 300;
export const PIPELINE_DEADLINE_MS = 120_000;
export const TOTAL_DEADLINE_MS = 280_000;

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
} as const;
