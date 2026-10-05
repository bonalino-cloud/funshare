import { analyzeStep } from "../analyze";
import { createRateLimiter, type RateLimiter } from "../ratelimit";
import { scrapeProfile } from "../scrape";
import type { HandlerDeps } from "./handlers";
import { createProfileCheckRepository } from "./repository";

export { createProfileCheck, getProfileCheck } from "./handlers";

// Лимитер живёт между вызовами одного инстанса: так работает его локальный кэш отказов.
let limiter: RateLimiter | undefined;

/** Боевые зависимости. Создаются лениво на каждый вызов: сборка и тесты не требуют ключей и БД. */
export function defaultDeps(schedule: HandlerDeps["schedule"]): HandlerDeps {
  limiter ??= createRateLimiter();
  return {
    repo: createProfileCheckRepository(),
    limiter,
    schedule,
    pipeline: {
      scrape: (username) => scrapeProfile(username),
      analyze: (input) => analyzeStep(input),
    },
    now: () => new Date(),
    secureCookie: process.env.NODE_ENV === "production",
  };
}

/** Для GET лимитер и пайплайн не нужны: только чтение. */
export function defaultReadDeps(): Pick<HandlerDeps, "repo" | "now"> {
  return { repo: createProfileCheckRepository(), now: () => new Date() };
}
