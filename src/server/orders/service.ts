import type { ErrorCode, Quote, Tier } from "@/contracts";
import { FREE_TRIAL_PER_DEVICE, FREE_TRIAL_PER_IP, quote, TIERS } from "../pricing";
import { normalizePromoCode } from "./normalize";
import type { OrderRepository, Person, PromoRow, Usage } from "./repository";

/** Причина отказа наружу. Для кода она одна на все случаи (правило 6): причину не выдаём. */
export type OrderFailure = Extract<ErrorCode, "promo_invalid" | "free_used" | "payment_required">;

export type CheckedPromo = { id: string; code: string; percentOff: number };

export type PromoCheck = { ok: true; promo: CheckedPromo } | { ok: false };

export type CheckPromoContext = {
  ownerTokenHash: string | null;
  ipHash: string;
  tier: Tier;
  now: Date;
};

/**
 * Годен ли код этому человеку: чистая функция от строки БД и счётчиков. Те же условия, что в WHERE
 * атомарного списания (`redeemSql`): здесь они нужны, чтобы посчитать цену ДО списания, а там
 * решают окончательно. Любая причина отказа сводится к одному `false`.
 */
export function evaluatePromo(
  row: PromoRow | null,
  usage: Usage | null,
  tier: Tier,
  now: Date,
): boolean {
  if (!row || !row.active) return false;
  if (!row.tiers.includes(tier)) return false;
  if (row.validFrom && row.validFrom > now) return false;
  if (row.validUntil && row.validUntil <= now) return false;
  if (row.redeemed >= row.maxRedemptions) return false;
  if (usage) {
    if (row.perDeviceLimit !== null && usage.device >= row.perDeviceLimit) return false;
    if (row.perIpLimit !== null && usage.ip >= row.perIpLimit) return false;
  }
  return true;
}

/**
 * Проверка кода без трат (для /api/quotes и как первый шаг `createOrder`).
 * Тариф с ценой 0 (Поджог): код не применяется, ответ тот же `promo_invalid`.
 */
export async function checkPromo(
  repo: OrderRepository,
  rawCode: string,
  ctx: CheckPromoContext,
): Promise<PromoCheck> {
  const code = normalizePromoCode(rawCode);
  if (code === "" || TIERS[ctx.tier].listAmount === 0) return { ok: false };

  const row = await repo.findPromo(code, {
    ownerTokenHash: ctx.ownerTokenHash,
    ipHash: ctx.ipHash,
  });
  if (!row || !evaluatePromo(row, row.usage, ctx.tier, ctx.now)) return { ok: false };
  return { ok: true, promo: { id: row.id, code, percentOff: row.percentOff } };
}

/** Есть ли у человека бесплатная проба Поджога. */
export async function isFreeTrialAvailable(
  repo: OrderRepository,
  person: Person,
): Promise<boolean> {
  const usage = await repo.trialUsage(person);
  return usage.device < FREE_TRIAL_PER_DEVICE && usage.ip < FREE_TRIAL_PER_IP;
}

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; errorCode: OrderFailure };

/**
 * POST /api/quotes: считает и проверяет, ничего не тратит и не пишет. Тариф вне `TIERS`/недоступный —
 * `TierUnavailableError` из `quote` (пробрасываем: это ошибка клиента, а не человека).
 * Поджог без пробы — `free_used`.
 */
export async function quoteFor(
  repo: OrderRepository,
  input: { tier: Tier; promoCode?: string },
  person: Person,
  now: Date,
): Promise<QuoteResult> {
  const info = TIERS[input.tier];
  if (info.available && info.listAmount === 0) {
    if (input.promoCode !== undefined) return { ok: false, errorCode: "promo_invalid" };
    if (!(await isFreeTrialAvailable(repo, person))) return { ok: false, errorCode: "free_used" };
    return { ok: true, quote: quote(input.tier, null, true) };
  }

  if (input.promoCode === undefined) return { ok: true, quote: quote(input.tier, null, false) };

  // Сначала цена: недоступный тариф не должен уходить в БД искать код.
  quote(input.tier, null, false);
  const checked = await checkPromo(repo, input.promoCode, { ...person, tier: input.tier, now });
  if (!checked.ok) return { ok: false, errorCode: "promo_invalid" };
  return {
    ok: true,
    quote: quote(
      input.tier,
      { code: input.promoCode.trim(), percentOff: checked.promo.percentOff },
      false,
    ),
  };
}

export type CreateOrderInput = {
  generationId: string;
  tier: Tier;
  promoCode?: string;
  ownerTokenHash: string;
  ipHash: string;
  now: Date;
};

export type CreateOrderResult =
  | {
      ok: true;
      order: {
        id: string;
        generationId: string;
        quote: Quote;
        reason: "first_free" | "promo_free";
      };
    }
  | { ok: false; errorCode: OrderFailure };

/**
 * Заказ перед генерацией (roast-engine §9.3). Цену считает сервер. Итог 0 → заказ `free` и (при коде)
 * атомарное списание; итог больше 0 → `payment_required` БЕЗ заказа и БЕЗ списания кода (билинга нет,
 * сжигать использование за заказ, который не стартует, нельзя). Повтор на ту же `generationId` бросает
 * `DuplicateOrderError`, не списывая код второй раз.
 */
export async function createOrder(
  repo: OrderRepository,
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const { tier, now, ownerTokenHash, ipHash } = input;
  const info = TIERS[tier];
  quote(tier, null, false); // недоступный тариф: TierUnavailableError до любого обращения к БД
  const amounts = { generationId: input.generationId, tier, listAmount: info.listAmount };

  // Бесплатный тариф: одна проба на человека. Код на нём не применяется.
  if (info.listAmount === 0) {
    if (input.promoCode !== undefined) return { ok: false, errorCode: "promo_invalid" };
    const q = quote(tier, null, true);
    const orderId = await repo.createTrialOrder({
      ...amounts,
      discountAmount: q.discountAmount,
      finalAmount: q.finalAmount,
      ownerTokenHash,
      ipHash,
      now,
      maxPerIp: FREE_TRIAL_PER_IP,
    });
    return orderId
      ? {
          ok: true,
          order: { id: orderId, generationId: input.generationId, quote: q, reason: "first_free" },
        }
      : { ok: false, errorCode: "free_used" };
  }

  if (input.promoCode === undefined) return { ok: false, errorCode: "payment_required" };

  const checked = await checkPromo(repo, input.promoCode, { ownerTokenHash, ipHash, tier, now });
  if (!checked.ok) return { ok: false, errorCode: "promo_invalid" };
  const q = quote(
    tier,
    { code: input.promoCode.trim(), percentOff: checked.promo.percentOff },
    false,
  );
  if (q.finalAmount > 0) return { ok: false, errorCode: "payment_required" };

  const orderId = await repo.redeemAndCreateOrder({
    ...amounts,
    discountAmount: q.discountAmount,
    finalAmount: q.finalAmount,
    promoCode: checked.promo.code,
    percentOff: checked.promo.percentOff,
    ownerTokenHash,
    ipHash,
    now,
  });
  // Проиграли гонку за последнее использование (или код поменяли между проверкой и списанием).
  if (!orderId) return { ok: false, errorCode: "promo_invalid" };
  return {
    ok: true,
    order: { id: orderId, generationId: input.generationId, quote: q, reason: "promo_free" },
  };
}

/**
 * Генерация упала без артефакта: освободить заказ (`voided`), использование кода (`releasedAt`,
 * `redeemed − 1`) и пробу Поджога (частичный индекс не считает `voided`). Идемпотентно.
 * Платный заказ (`paid`) не трогает: им займётся возврат денег (`be/p4-billing`).
 */
export async function releaseOrder(
  repo: Pick<OrderRepository, "release">,
  orderId: string,
  now: Date,
) {
  return repo.release(orderId, now);
}
