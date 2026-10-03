import { z } from "zod";
import { Tier } from "./generation";

/**
 * Цены и «волшебное слово». Деньги везде одним полем-типом: целое число копеек, валюта RUB.
 * Клиент цену не присылает и ей не доверяет: считает сервер.
 */

export const Currency = z.literal("RUB");
export type Currency = z.infer<typeof Currency>;

/** Целые копейки: 19900 = 199 ₽. */
export const Amount = z.number().int().nonnegative();

/** Состав тарифа. Тексты карточек живут у FE, здесь только числа. */
export const TierInfo = z.object({
  tier: Tier,
  listAmount: Amount,
  currency: Currency,
  /**
   * Максимумы (roast-engine §7.1a, все числа «до»): сколько новых шуток сгенерируем, сколько
   * человек выберет в артефакт (от 1 до `selectCount`) и сколько картинок — по одной на
   * выбранную шутку, не больше `imageCount`.
   */
  candidateCount: z.number().int().positive(),
  selectCount: z.number().int().positive(),
  imageCount: z.number().int().nonnegative(),
  /** Тариф можно купить. Пекло в MVP — заглушка: `false`, карточка «скоро», цену не показываем. */
  available: z.boolean(),
  /** Видео для сторис доступно сейчас (у Пекла пока false: кнопка есть, но неактивна). */
  video: z.boolean(),
});
export type TierInfo = z.infer<typeof TierInfo>;

/** GET /api/pricing — ответ. */
export const Pricing = z.object({
  tiers: z.array(TierInfo).length(3),
  /** Бесплатная проба Поджога ещё доступна этому устройству. */
  freeTrialAvailable: z.boolean(),
});
export type Pricing = z.infer<typeof Pricing>;

/** POST /api/quotes — тело. Только считает и проверяет слово, ничего не тратит. */
export const QuoteRequest = z.object({
  tier: Tier,
  promoCode: z.string().trim().min(1).max(40).optional(),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

/** POST /api/quotes — ответ. При неверном слове — ошибка `promo_invalid`, а не Quote. */
export const Quote = z
  .object({
    tier: Tier,
    listAmount: Amount,
    discountAmount: Amount,
    finalAmount: Amount,
    currency: Currency,
    promo: z
      .object({
        code: z.string().min(1),
        percentOff: z.number().int().min(1).max(100),
      })
      .optional(),
    /** Итог 0 из-за бесплатной пробы Поджога, а не промокода. */
    freeTrial: z.boolean().optional(),
  })
  .refine((q) => q.listAmount - q.discountAmount === q.finalAmount, {
    message: "finalAmount = listAmount − discountAmount",
    path: ["finalAmount"],
  });
export type Quote = z.infer<typeof Quote>;
