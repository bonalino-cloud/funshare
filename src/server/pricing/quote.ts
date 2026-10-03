import { Quote, type Tier } from "@/contracts";
import { TIERS } from "./config";

export class TierUnavailableError extends Error {
  constructor(tier: Tier) {
    super(`Тариф ${tier} недоступен`);
    this.name = "TierUnavailableError";
  }
}

/** Проверенный код: то, что нужно для цены. */
export type PromoDiscount = { code: string; percentOff: number };

/**
 * Скидка в копейках: целая часть от `list × percent / 100`, округление вниз. Вниз — чтобы скидка
 * никогда не превышала цену (`list − discount ≥ 0`), а `list − discount = final` держится по
 * построению (`final` не округляется отдельно). 100 % даёт ровно `list`, итог 0.
 */
export function discountFor(listAmount: number, percentOff: number): number {
  return Math.floor((listAmount * percentOff) / 100);
}

/**
 * Чистый расчёт цены. Недоступный тариф (Пекло) — ошибка, а не «бесплатно».
 * `freeTrial` — человек берёт бесплатную пробу Поджога; флаг имеет смысл только у тарифа с ценой 0.
 * Код на тарифе с ценой 0 не применяется (скидывать нечего, списывать код незачем).
 */
export function quote(tier: Tier, promo: PromoDiscount | null, freeTrial: boolean): Quote {
  const info = TIERS[tier];
  if (!info.available) throw new TierUnavailableError(tier);

  const listAmount = info.listAmount;
  const applied = promo !== null && listAmount > 0 ? promo : null;
  if (
    applied &&
    (!Number.isInteger(applied.percentOff) || applied.percentOff < 1 || applied.percentOff > 100)
  ) {
    throw new RangeError("percentOff должен быть целым от 1 до 100");
  }
  const discountAmount = applied ? discountFor(listAmount, applied.percentOff) : 0;

  return Quote.parse({
    tier,
    listAmount,
    discountAmount,
    finalAmount: listAmount - discountAmount,
    currency: info.currency,
    ...(applied ? { promo: { code: applied.code, percentOff: applied.percentOff } } : {}),
    ...(freeTrial && listAmount === 0 ? { freeTrial: true } : {}),
  });
}
