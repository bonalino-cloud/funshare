import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { parseServerEnv, redisCredentials } from "../env";

/**
 * Лимиты на проверки профиля: «не больше 5 проверок в час на устройство и IP» (roast-engine.md,
 * таблица рисков, «Деньги»; create-flow.md, шаг 1). Проверка тратит деньги на Apify и LLM, поэтому
 * главный ключ — IP: cookie чистится за секунду, IP сменить дороже. Суточное окно по IP режет
 * долгий перебор: 5 в час круглые сутки — уже 120 платных проверок.
 */
export const LIMITS = {
  ipPerHour: { requests: 5, window: "1 h" },
  ipPerDay: { requests: 30, window: "1 d" },
  ownerPerHour: { requests: 5, window: "1 h" },
} as const;

/** Сколько ждём Redis. Дольше — считаем лимитер недоступным (а не пропускаем запрос). */
export const REDIS_TIMEOUT_MS = 3000;

export type RateLimitInput = { ipHash: string; ownerHash: string | null };

export type RateLimiter = {
  /** `true` — запрос можно пускать. Бросает, если лимитер недоступен: вызывающий отказывает. */
  check(input: RateLimitInput): Promise<boolean>;
};

/** То, что нужно от одного окна лимита. В тестах подменяется фейком. */
export type Limit = { limit(key: string): Promise<{ success: boolean }> };

export class RateLimitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitUnavailableError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RateLimitUnavailableError("Redis не ответил")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Склейка окон. Каждый запрос тратит все окна своего ключа (без короткого замыкания): иначе
 * отказ по минутному окну не учитывался бы в суточном и перебор шёл бы «бесплатно».
 */
export function composeLimiter(
  limits: { ip: Limit[]; owner: Limit[] },
  timeoutMs = REDIS_TIMEOUT_MS,
): RateLimiter {
  return {
    async check({ ipHash, ownerHash }) {
      const calls = [
        ...limits.ip.map((l) => l.limit(`ip:${ipHash}`)),
        ...(ownerHash ? limits.owner.map((l) => l.limit(`owner:${ownerHash}`)) : []),
      ];
      let results;
      try {
        results = await withTimeout(Promise.all(calls), timeoutMs);
      } catch (error) {
        if (error instanceof RateLimitUnavailableError) throw error;
        throw new RateLimitUnavailableError(error instanceof Error ? error.name : "Redis");
      }
      return results.every((r) => r.success);
    },
  };
}

let warnedNoRedis = false;

/**
 * Лимитер для проверок. Без Redis в env:
 * - dev/test: пускаем всех и один раз пишем предупреждение — локально Redis не нужен;
 * - production: не открываем дыру — каждая проверка падает `RateLimitUnavailableError`
 *   (вызывающий отвечает 503), потому что без лимита любой может сжечь бюджет Apify и LLM.
 */
export function createRateLimiter(
  source: Record<string, string | undefined> = process.env,
  production = process.env.NODE_ENV === "production",
): RateLimiter {
  const credentials = redisCredentials(parseServerEnv(source));

  if (!credentials) {
    if (production) {
      return {
        async check() {
          console.error("[ratelimit] Redis не настроен в production: проверки закрыты");
          throw new RateLimitUnavailableError("Redis не настроен");
        },
      };
    }
    return {
      async check() {
        if (!warnedNoRedis) {
          warnedNoRedis = true;
          console.warn("[ratelimit] Redis не настроен: лимиты отключены (только dev)");
        }
        return true;
      },
    };
  }

  const redis = new Redis({ url: credentials.url, token: credentials.token });
  const window = (name: string, { requests, window }: { requests: number; window: string }) =>
    new Ratelimit({
      redis,
      prefix: `rl:profile-check:${name}`,
      limiter: Ratelimit.slidingWindow(
        requests,
        window as Parameters<typeof Ratelimit.slidingWindow>[1],
      ),
      // Таймаут по умолчанию (5 с) пропускает запрос при сбое сети; нам нужен отказ, см. withTimeout.
      timeout: 0,
      analytics: false,
    });

  return composeLimiter({
    ip: [window("ip-hour", LIMITS.ipPerHour), window("ip-day", LIMITS.ipPerDay)],
    owner: [window("owner-hour", LIMITS.ownerPerHour)],
  });
}
