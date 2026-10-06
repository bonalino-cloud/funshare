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
 * `claude-sonnet-5`, $ за 1M токенов. Сверено 2026-10-06 со страницей цен Anthropic
 * (https://platform.claude.com/docs/en/about-claude/pricing): вход $2, выход $10, чтение кэша $0.20,
 * запись в 5-минутный кэш $2.50 (запись в 1-часовой кэш $4 не используем). $2 / $10 были вводной
 * ценой, на дату сверки это постоянный стандарт. Параметр `inference_geo: "us"` даёт ×1.1: мы его
 * не передаём (глобальная маршрутизация по умолчанию), цену не множим. Если начнём передавать,
 * цену надо поднять здесь.
 * Сейчас промпт-кэш в вызовах не используется, на сумму кэш-цены не влияют.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-sonnet-5": {
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    cacheReadUsdPerMTok: 0.2,
    cacheWriteUsdPerMTok: 2.5,
    verified: true,
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
 * Apify `apify~instagram-profile-scraper`. Сверено 2026-10-06 по публичному API актора
 * (поле `pricingInfos`) и странице https://apify.com/apify/instagram-profile-scraper. Модель
 * PAY_PER_EVENT, основное событие `profile` («каждый профиль, записанный в датасет»). Цена события
 * зависит от плана аккаунта Apify: FREE $0.0026, BRONZE (Starter) $0.0023, SILVER $0.002,
 * GOLD $0.0016, PLATINUM $0.0011, DIAMOND $0.0005. Аккаунт проекта на плане FREE, берём $0.0026.
 * СМЕНИЛИ ПЛАН Apify: правим цифру здесь и `PRICES_CHECKED_AT`.
 *
 * Платную надстройку `about-account` (FREE $0.007 за профиль) НЕ включаем: вход актора в
 * `scrape/apify.ts` только `{ usernames: [username] }`. Включим: цену надстройки надо добавить сюда.
 *
 * Стоимость скрейпа по-прежнему ОЦЕНКА (число результатов × цена за результат): эндпоинт
 * `run-sync-get-dataset-items` отдаёт только элементы датасета, ни `usageTotalUsd`, ни фактического
 * списания в ответе нет (клиента `apify-client` нет, запросы идут через `fetch`). Поэтому строка
 * Apify в `CostRun` остаётся с `source: "estimate"`, а `verified` говорит лишь о том, что сама цена
 * за результат сверена.
 */
export const APIFY_PRICE: ApifyPrice = {
  actor: "apify~instagram-profile-scraper",
  usdPerResult: 0.0026,
  verified: true,
};
