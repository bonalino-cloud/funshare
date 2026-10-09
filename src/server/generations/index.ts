import { defaultEnsureDossier } from "../dossier";
import { createOrderRepository } from "../orders";
import { removePublic } from "../profile-check/avatar";
import { discardMinorAvatar } from "../profile-check/minor";
import { createProfileCheckRepository } from "../profile-check/repository";
import { createPromoGuard, type PromoGuard } from "../ratelimit/promo";
import type { GenerationsHandlerDeps, SelectionHandlerDeps } from "./handlers";
import { createGenerationRepository, newGenerationId } from "./repository";
import { resumeSelection, startWorkflow } from "./workflow";

export { createGeneration, getCandidates, getGeneration, postSelection } from "./handlers";

// Лимитер живёт между вызовами одного инстанса.
let guard: PromoGuard | undefined;

/** Боевые зависимости. Лениво на каждый вызов: сборка и тесты не требуют ключей и БД. */
export function defaultDeps(): GenerationsHandlerDeps {
  guard ??= createPromoGuard();
  const profiles = createProfileCheckRepository();
  return {
    repo: createGenerationRepository(),
    profiles,
    orders: createOrderRepository(),
    guard,
    ensureDossier: defaultEnsureDossier(),
    onMinor: ({ igUsername, avatarUrl }) =>
      discardMinorAvatar({ removeAvatar: removePublic, repo: profiles }, igUsername, avatarUrl),
    startWorkflow,
    newId: newGenerationId,
    now: () => new Date(),
  };
}

/** Для GET нужна только строка генерации. */
export function defaultReadDeps(): Pick<GenerationsHandlerDeps, "repo"> {
  return { repo: createGenerationRepository() };
}

/** Для выбора шуток: строка генерации, кандидаты, пробуждение workflow. */
export function defaultSelectionDeps(): SelectionHandlerDeps {
  return { repo: createGenerationRepository(), resumeSelection, now: () => new Date() };
}
