import { createOrderRepository } from "../orders";
import { createProfileCheckRepository } from "../profile-check/repository";
import { createPromoGuard, type PromoGuard } from "../ratelimit/promo";
import type { GenerationsHandlerDeps } from "./handlers";
import { createGenerationRepository, newGenerationId } from "./repository";
import { startWorkflow } from "./workflow";

export { createGeneration, getGeneration } from "./handlers";

// Лимитер живёт между вызовами одного инстанса.
let guard: PromoGuard | undefined;

/** Боевые зависимости. Лениво на каждый вызов: сборка и тесты не требуют ключей и БД. */
export function defaultDeps(): GenerationsHandlerDeps {
  guard ??= createPromoGuard();
  return {
    repo: createGenerationRepository(),
    profiles: createProfileCheckRepository(),
    orders: createOrderRepository(),
    guard,
    startWorkflow,
    newId: newGenerationId,
    now: () => new Date(),
  };
}

/** Для GET нужна только строка генерации. */
export function defaultReadDeps(): Pick<GenerationsHandlerDeps, "repo"> {
  return { repo: createGenerationRepository() };
}
