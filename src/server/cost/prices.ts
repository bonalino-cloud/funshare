/**
 * Цены для учёта стоимости генерации (задача `be/p1-cost-log`). Единственное место в коде, где
 * лежат деньги провайдеров: остальной код считает токены и штуки, цену берёт отсюда.
 *
 * Валюта USD. Цены LLM — за миллион токенов. Меняли цену — правим здесь и обновляем
 * `PRICES_CHECKED_AT`; записанные в БД строки хранят `pricesAsOf`, по ним видно, по какой
 * таблице считали.
 */

/** Дата последней сверки таблицы с прайсами провайдеров. */
export const PRICES_CHECKED_AT = "2026-10-06";

export type ModelPrice = {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** Чтение из кэша промпта. */
  cacheReadUsdPerMTok: number;
  /** Запись в кэш промпта (5 минут). */
  cacheWriteUsdPerMTok: number;
  /**
   * `true` — цифры сверены с прайсом провайдера; `false` — заглушка или вывод из множителей.
   * Строка стоимости с неподтверждённой ценой помечается `estimated`.
   */
  verified: boolean;
};

/**
 * `claude-sonnet-5`: вход и выход — прайс Anthropic из справочника `claude-api` (кэш 2026-09-25):
 * $2 / $10 за 1M. Кэш: чтение $0.20 (0.1x), запись $2.50 (1.25x для 5-минутного кэша) выведены
 * из множителей, поэтому `verified: false`, пока цифры не сверит человек в console.anthropic.com.
 * Сейчас промпт-кэш в вызовах не используется, на сумму это не влияет.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-sonnet-5": {
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    cacheReadUsdPerMTok: 0.2,
    cacheWriteUsdPerMTok: 2.5,
    verified: false,
  },
};

/**
 * Модель, которой нет в таблице (подменили через `WriteDeps.models`): считаем по самой дорогой
 * записи таблицы, чтобы не занизить траты, и помечаем строку как оценку.
 */
export function priceForModel(model: string): { price: ModelPrice; known: boolean } {
  const exact = MODEL_PRICES[model];
  if (exact) return { price: exact, known: true };
  const all = Object.values(MODEL_PRICES);
  const priciest = all.reduce((a, b) => (b.outputUsdPerMTok > a.outputUsdPerMTok ? b : a));
  return { price: { ...priciest, verified: false }, known: false };
}

export type ApifyPrice = {
  /** Актор, к которому относится тариф. */
  actor: string;
  /** Цена одного результата актора (один профиль), USD. */
  usdPerResult: number;
  /** Сверена ли цена с тарифом актора. */
  verified: boolean;
};

/**
 * Apify `apify~instagram-profile-scraper`. Эндпоинт `run-sync-get-dataset-items` отдаёт только
 * элементы датасета: ни `usageTotalUsd`, ни фактического списания в ответе нет (клиента
 * `apify-client` нет, запросы идут через `fetch`). Поэтому стоимость — ОЦЕНКА: число результатов
 * × цена за результат. ЗАГЛУШКА $2.30 за 1000 профилей: цифра не взята из репо и не сверена,
 * её надо подтвердить на странице актора и в Billing Apify (открытый вопрос задачи).
 */
export const APIFY_PRICE: ApifyPrice = {
  actor: "apify~instagram-profile-scraper",
  usdPerResult: 0.0023,
  verified: false,
};
