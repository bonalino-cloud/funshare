import { describe, expect, it } from "vitest";
import { Pricing, Quote, TierInfo } from "@/contracts";
import { buildPricing, hasFreeTrial, TIERS } from "./config";
import { discountFor, quote, TierUnavailableError } from "./quote";

describe("тарифы", () => {
  it("числа из roast-engine §7.1a, цены в копейках", () => {
    expect(TIERS[1]).toMatchObject({
      listAmount: 9900,
      candidateCount: 10,
      selectCount: 6,
      imageCount: 0,
      available: true,
    });
    expect(TIERS[2]).toMatchObject({
      listAmount: 9900,
      candidateCount: 20,
      selectCount: 6,
      imageCount: 6,
      available: true,
    });
    expect(TIERS[3].available).toBe(false);
  });

  it("каждый тариф и весь ответ проходят контракт", () => {
    for (const tier of [1, 2, 3] as const) {
      expect(TierInfo.safeParse(TIERS[tier]).success).toBe(true);
    }
    expect(Pricing.parse(buildPricing(true)).freeTrialAvailable).toBe(true);
    expect(buildPricing(false).freeTrialAvailable).toBe(false);
    expect(buildPricing(true).tiers.map((t) => t.tier)).toEqual([1, 2, 3]);
  });
});

describe("quote", () => {
  it("Кострище без кода: полная цена", () => {
    expect(quote(2, null, false)).toEqual({
      tier: 2,
      listAmount: 9900,
      discountAmount: 0,
      finalAmount: 9900,
      currency: "RUB",
    });
  });

  it("Поджог: проба — вся цена скидкой, итог 0, флаг freeTrial", () => {
    expect(quote(1, null, true)).toMatchObject({
      listAmount: 9900,
      discountAmount: 9900,
      finalAmount: 0,
      freeTrial: true,
    });
  });

  it("Поджог без пробы: обычная цена 99 ₽, без флага", () => {
    const q = quote(1, null, false);
    expect(q).toMatchObject({ listAmount: 9900, discountAmount: 0, finalAmount: 9900 });
    expect(q.freeTrial).toBeUndefined();
  });

  it("Поджог без пробы + код на 50 %: скидка по коду, как у Кострища", () => {
    expect(quote(1, { code: "HALF", percentOff: 50 }, false)).toMatchObject({
      discountAmount: 4950,
      finalAmount: 4950,
      promo: { code: "HALF", percentOff: 50 },
    });
  });

  it("проба важнее кода: код в расчёт не входит", () => {
    const q = quote(1, { code: "FREE", percentOff: 50 }, true);
    expect(q.promo).toBeUndefined();
    expect(q).toMatchObject({ discountAmount: 9900, finalAmount: 0, freeTrial: true });
  });

  it("признак пробы живёт в одном месте: только Поджог", () => {
    expect([1, 2, 3].map((t) => hasFreeTrial(t as 1 | 2 | 3))).toEqual([true, false, false]);
    expect(quote(2, null, true).freeTrial).toBeUndefined();
  });

  it("-50 %: целые копейки, list - discount = final", () => {
    const q = quote(2, { code: "HALF", percentOff: 50 }, false);
    expect(q).toMatchObject({
      discountAmount: 4950,
      finalAmount: 4950,
      promo: { code: "HALF", percentOff: 50 },
    });
  });

  it("-100 %: итог ровно 0", () => {
    const q = quote(2, { code: "FREE", percentOff: 100 }, false);
    expect(q.discountAmount).toBe(9900);
    expect(q.finalAmount).toBe(0);
  });

  it("на всех процентах и неровных ценах: скидка целая, не больше цены, 100 % = вся цена", () => {
    for (const list of [0, 1, 99, 9900, 12_345, 99_999]) {
      for (let percent = 1; percent <= 100; percent++) {
        const discount = discountFor(list, percent);
        expect(Number.isInteger(discount)).toBe(true);
        expect(discount).toBeGreaterThanOrEqual(0);
        expect(discount).toBeLessThanOrEqual(list);
      }
      expect(discountFor(list, 100)).toBe(list);
    }
  });

  it("округление скидки вниз (в пользу магазина на копейку)", () => {
    expect(discountFor(9900, 33)).toBe(3267);
    expect(discountFor(101, 50)).toBe(50);
    expect(discountFor(1, 99)).toBe(0);
  });

  it("код на тарифе с ценой 0 (Пекло) не применяется", () => {
    expect(() => quote(3, { code: "FREE", percentOff: 100 }, false)).toThrow(TierUnavailableError);
  });

  it("Пекло недоступно: ошибка, а не бесплатно", () => {
    expect(() => quote(3, null, false)).toThrow(TierUnavailableError);
    expect(() => quote(3, { code: "X", percentOff: 100 }, true)).toThrow(TierUnavailableError);
  });

  it("битый процент отвергается", () => {
    for (const percentOff of [0, 101, 50.5, -1, Number.NaN]) {
      expect(() => quote(2, { code: "X", percentOff }, false)).toThrow(RangeError);
    }
  });

  it("результат проходит Quote.parse", () => {
    expect(Quote.safeParse(quote(2, { code: "X", percentOff: 7 }, false)).success).toBe(true);
  });
});
