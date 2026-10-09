import { Pricing, TierInfo, type Tier } from "@/contracts";

/**
 * Цены и состав тарифов живут только здесь (roast-engine §7.1a, §9.1). Клиент цену не присылает:
 * считает сервер. Деньги — целые копейки, валюта RUB.
 *
 * Числа берём из §7.1a: Поджог — до 10 шуток, выбор до 6, картинок нет; Кострище — до 20 новых
 * шуток (плюс выбранные в Поджоге, их подмешивает генерация), выбор до 6, до 6 картинок (по
 * одной на выбранную). Пекло — заглушка: числа-плейсхолдеры нужны только потому, что `TierInfo`
 * требует положительные `candidateCount`/`selectCount`; цену не показываем (0), купить нельзя.
 */
export const TIERS: Record<Tier, TierInfo> = {
  1: TierInfo.parse({
    tier: 1,
    listAmount: 9900,
    currency: "RUB",
    candidateCount: 10,
    selectCount: 6,
    imageCount: 0,
    available: true,
    video: false,
  }),
  2: TierInfo.parse({
    tier: 2,
    listAmount: 9900,
    currency: "RUB",
    candidateCount: 20,
    selectCount: 6,
    imageCount: 6,
    available: true,
    video: false,
  }),
  3: TierInfo.parse({
    tier: 3,
    listAmount: 0,
    currency: "RUB",
    candidateCount: 20,
    selectCount: 6,
    imageCount: 6,
    available: false,
    video: false,
  }),
};

/**
 * Бесплатная проба Поджога (§7.1a): по устройству (cookie `ownerToken`) — один раз, жёстко
 * (уникальный индекс в БД). По IP — мягче: «по любому из ключей» из §7.1a без запаса блокировало бы
 * честных людей за одним мобильным/офисным IP (тот же довод, что в §9.3 п. 7), поэтому до трёх проб
 * на IP. Проба стоит только текст без картинок; масштаб абуза режет дневной потолок трат (§8).
 */
export const FREE_TRIAL_PER_DEVICE = 1;
export const FREE_TRIAL_PER_IP = 3;

/**
 * Тариф с бесплатной пробой (решение Сергея 06.10, #99): первый Поджог бесплатно, каждый следующий
 * по обычной цене 99 ₽. Единственная точка истины: «пробный» тариф определяется здесь, а не ценой 0.
 */
export const FREE_TRIAL_TIER: Tier = 1;

export function hasFreeTrial(tier: Tier): boolean {
  return tier === FREE_TRIAL_TIER;
}

/** Ответ GET /api/pricing. Проходит `Pricing.parse` (инвариант 20). */
export function buildPricing(freeTrialAvailable: boolean): Pricing {
  return Pricing.parse({ tiers: [TIERS[1], TIERS[2], TIERS[3]], freeTrialAvailable });
}
