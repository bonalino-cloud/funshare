import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { parseServerEnv, redisCredentials } from "../env";
import {
  RateLimitUnavailableError,
  REDIS_TIMEOUT_MS,
  withTimeout,
  type Limit,
  type RateLimitInput,
} from ".";

/**
 * Лимит на перебор промокодов (roast-engine §9.3 п. 6): 5 НЕВЕРНЫХ попыток за 10 минут по IP и по
 * устройству = пауза (`rate_limited`). Верные попытки лимит не тратят: человек с настоящим кодом
 * может пересчитывать цену сколько угодно.
 *
 * Чтобы считать только неверные, окно «неверных» проверяется перед работой (`remaining`, ничего не
 * тратит), а тратится после неудачи (`limit`). Между проверкой и записью есть зазор: пачка
 * параллельных запросов успевает пройти проверку до первой записи. Его закрывает второе окно,
 * «любые попытки»: оно тратится атомарно ДО проверки кода и ограничивает пачку 30 запросами за 10
 * минут на ключ (вместо неограниченной).
 */
export const PROMO_LIMITS = {
  failures: { requests: 5, window: "10 m" },
  attempts: { requests: 30, window: "10 m" },
} as const;

/** Окно, у которого можно спросить остаток, не тратя его. */
export type PeekLimit = Limit & { remaining(key: string): Promise<number> };

export type PromoGuard = {
  /**
   * Вызывать перед проверкой кода. `true` — можно проверять. `false` — пауза, отвечаем `rate_limited`.
   * Бросает, если лимитер недоступен: вызывающий отказывает (503).
   */
  enter(input: RateLimitInput): Promise<boolean>;
  /** Записать НЕВЕРНУЮ попытку. Сбой записи не ломает ответ (лимитер уже отвечал в `enter`). */
  fail(input: RateLimitInput): Promise<void>;
};

type Windows<T> = { ip: T; owner: T };

export function composePromoGuard(
  windows: { attempts: Windows<Limit>; failures: Windows<PeekLimit> },
  timeoutMs = REDIS_TIMEOUT_MS,
): PromoGuard {
  const unavailable = (error: unknown) =>
    error instanceof RateLimitUnavailableError
      ? error
      : new RateLimitUnavailableError(error instanceof Error ? error.name : "Redis");

  return {
    async enter({ ipHash, ownerHash }) {
      try {
        const [attempts, remaining] = await withTimeout(
          Promise.all([
            Promise.all([
              windows.attempts.ip.limit(`ip:${ipHash}`),
              ...(ownerHash ? [windows.attempts.owner.limit(`owner:${ownerHash}`)] : []),
            ]),
            Promise.all([
              windows.failures.ip.remaining(`ip:${ipHash}`),
              ...(ownerHash ? [windows.failures.owner.remaining(`owner:${ownerHash}`)] : []),
            ]),
          ]),
          timeoutMs,
        );
        return attempts.every((r) => r.success) && remaining.every((n) => n > 0);
      } catch (error) {
        throw unavailable(error);
      }
    },

    async fail({ ipHash, ownerHash }) {
      try {
        await withTimeout(
          Promise.all([
            windows.failures.ip.limit(`ip:${ipHash}`),
            ...(ownerHash ? [windows.failures.owner.limit(`owner:${ownerHash}`)] : []),
          ]),
          timeoutMs,
        );
      } catch (error) {
        console.error(
          `[ratelimit] не записали неверную попытку: ${error instanceof Error ? error.name : ""}`,
        );
      }
    },
  };
}

let warnedNoRedis = false;

/**
 * Без Redis в env: dev/test — пускаем и один раз предупреждаем; production — закрыто
 * (`enter` бросает), потому что без лимита промокоды перебираются.
 */
export function createPromoGuard(
  source: Record<string, string | undefined> = process.env,
  production = process.env.NODE_ENV === "production",
): PromoGuard {
  const credentials = redisCredentials(parseServerEnv(source));

  if (!credentials) {
    if (production) {
      return {
        async enter() {
          console.error("[ratelimit] Redis не настроен в production: промокоды закрыты");
          throw new RateLimitUnavailableError("Redis не настроен");
        },
        async fail() {},
      };
    }
    return {
      async enter() {
        if (!warnedNoRedis) {
          warnedNoRedis = true;
          console.warn(
            "[ratelimit] Redis не настроен: лимит на перебор кодов отключён (только dev)",
          );
        }
        return true;
      },
      async fail() {},
    };
  }

  const redis = new Redis({ url: credentials.url, token: credentials.token });
  const make = (name: string, { requests, window }: { requests: number; window: string }) =>
    new Ratelimit({
      redis,
      prefix: `rl:promo:${name}`,
      limiter: Ratelimit.slidingWindow(
        requests,
        window as Parameters<typeof Ratelimit.slidingWindow>[1],
      ),
      timeout: 0,
      analytics: false,
    });
  const peek = (name: string, config: { requests: number; window: string }): PeekLimit => {
    const rl = make(name, config);
    return {
      limit: (key) => rl.limit(key),
      remaining: async (key) => (await rl.getRemaining(key)).remaining,
    };
  };

  return composePromoGuard({
    attempts: {
      ip: make("attempts-ip", PROMO_LIMITS.attempts),
      owner: make("attempts-owner", PROMO_LIMITS.attempts),
    },
    failures: {
      ip: peek("failures-ip", PROMO_LIMITS.failures),
      owner: peek("failures-owner", PROMO_LIMITS.failures),
    },
  });
}
