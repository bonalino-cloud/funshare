import { createPromoGuard, type PromoGuard } from "../ratelimit/promo";
import type { OrdersHandlerDeps } from "./handlers";
import { createOrderRepository } from "./repository";

export { getPricing, postQuote } from "./handlers";
export { guardPromoAttempt } from "./guard";
export { normalizePromoCode } from "./normalize";
export { DuplicateOrderError, createOrderRepository, type OrderRepository } from "./repository";
export {
  checkPromo,
  createOrder,
  isFreeTrialAvailable,
  quoteFor,
  releaseOrder,
  type CreateOrderInput,
  type CreateOrderResult,
} from "./service";

// Лимитер живёт между вызовами одного инстанса.
let guard: PromoGuard | undefined;

/** Боевые зависимости. Лениво на каждый вызов: сборка и тесты не требуют ключей и БД. */
export function defaultDeps(): OrdersHandlerDeps {
  guard ??= createPromoGuard();
  return { repo: createOrderRepository(), guard, now: () => new Date() };
}
