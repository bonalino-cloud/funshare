import { analyzeStep, defaultAnalyzeDeps } from "../analyze";
import { createPersonaRepository } from "../analyze/repository";
import { createRateLimiter, type RateLimiter } from "../ratelimit";
import { defaultScrapeDeps, scrapeProfile } from "../scrape";
import { createAvatarCopier } from "./avatar";
import type { HandlerDeps } from "./handlers";
import { createProfileCheckRepository } from "./repository";

export { createProfileCheck, getProfileCheck } from "./handlers";

// Лимитер живёт между вызовами одного инстанса: так работает его локальный кэш отказов.
let limiter: RateLimiter | undefined;
const avatarCopier = createAvatarCopier();

/** Боевые зависимости. Создаются лениво на каждый вызов: сборка и тесты не требуют ключей и БД. */
export function defaultDeps(schedule: HandlerDeps["schedule"]): HandlerDeps {
  limiter ??= createRateLimiter();
  return {
    repo: createProfileCheckRepository(),
    limiter,
    schedule,
    pipeline: {
      // Счётчик трат один на проверку: его создаёт `runProfileCheck` и отдаёт в оба шага.
      scrape: (username, meter) => scrapeProfile(username, { ...defaultScrapeDeps(), meter }),
      analyze: (input, meter) =>
        analyzeStep(input, { ...defaultAnalyzeDeps(meter), personas: createPersonaRepository() }),
      copyAvatar: avatarCopier,
    },
    now: () => new Date(),
    secureCookie: process.env.NODE_ENV === "production",
  };
}

/** Для GET лимитер и пайплайн не нужны: только чтение. */
export function defaultReadDeps(): Pick<HandlerDeps, "repo" | "now"> {
  return { repo: createProfileCheckRepository(), now: () => new Date() };
}
