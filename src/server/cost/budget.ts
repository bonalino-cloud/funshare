import { Redis } from "@upstash/redis";
import { parseServerEnv, redisCredentials } from "../env";
import { RateLimitUnavailableError, REDIS_TIMEOUT_MS, withTimeout } from "../ratelimit";
import { APIFY_PRICE } from "./prices";

/**
 * Дневной потолок трат на Apify (решение Дениса 2026-10-20, задача `be/p3-cost-guard`).
 * Считаем ТОЛЬКО скрейп Instagram; траты модели этим потолком не ограничиваются.
 *
 * Счётчик в Redis: ключ `budget:apify:YYYY-MM-DD` (сутки по UTC), целые микродоллары, TTL 48 ч.
 * Атомарность без read-then-write: перед каждым обращением к Apify `INCRBY` на цену одного
 * результата; новое значение выше потолка → `DECRBY` обратно и отказ. После ответа аренда
 * уточняется по числу полученных результатов (`settle`).
 */
export const DEFAULT_APIFY_DAILY_BUDGET_USD = 5;
const KEY_PREFIX = "budget:apify:";
const KEY_TTL_SECONDS = 48 * 60 * 60;
/** Не чаще одной строки лога «потолок исчерпан» в минуту на инстанс: иначе атака забьёт лог. */
const LOG_EVERY_MS = 60_000;

const toMicro = (usd: number) => Math.round(usd * 1_000_000);
/** Цена одного результата, микро-USD: столько резервируем под одно обращение. */
export const APIFY_RESERVE_MICRO_USD = toMicro(APIFY_PRICE.usdPerResult);

/**
 * Потолок из `APIFY_DAILY_BUDGET_USD`, микро-USD. Пусто → 5. `0` — осознанный выключатель Apify
 * (все платные проверки отказываются). Нечисло, отрицательное и бесконечность — опечатка: берём 5
 * и пишем в лог, потому что «без потолка» (деньги текут) и «ноль» (продукт молча встал) хуже.
 */
export function apifyDailyCapMicroUsd(
  source: Record<string, string | undefined> = process.env,
): number {
  const raw = source.APIFY_DAILY_BUDGET_USD?.trim();
  if (!raw) return toMicro(DEFAULT_APIFY_DAILY_BUDGET_USD);
  const value = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) {
    console.error(
      `[budget] APIFY_DAILY_BUDGET_USD задан неверно, берём ${DEFAULT_APIFY_DAILY_BUDGET_USD}`,
    );
    return toMicro(DEFAULT_APIFY_DAILY_BUDGET_USD);
  }
  return toMicro(value);
}

/** Ключ суток по UTC. */
export function budgetKey(now: Date): string {
  return `${KEY_PREFIX}${now.toISOString().slice(0, 10)}`;
}

/** Хранилище счётчика. В тестах подменяется фейком. */
export type CounterStore = {
  /** Атомарно прибавить (или вычесть) и вернуть новое значение; продлевает TTL ключа. */
  add(key: string, delta: number, ttlSeconds: number): Promise<number>;
  /** Текущее значение (нет ключа → 0). */
  get(key: string): Promise<number>;
};

/** Аренда на одно обращение к Apify. `settle` не бросает. */
export type ApifyLease = {
  /** Сколько результатов вернул Apify: аренда пересчитывается до `results × цена`. */
  settle(results: number): Promise<void>;
};

export type ApifyBudget = {
  /** Есть ли место ещё на одно обращение (только чтение, ничего не резервирует). Бросает, если счётчик недоступен. */
  hasRoom(): Promise<boolean>;
  /** Зарезервировать одно обращение. `null` — потолок исчерпан. Бросает, если счётчик недоступен. */
  reserve(): Promise<ApifyLease | null>;
};

const cents = (microUsd: number) => Math.ceil(microUsd / 10_000);

export function createApifyBudget(deps: {
  store: CounterStore;
  capMicroUsd: number;
  now?: () => Date;
  timeoutMs?: number;
}): ApifyBudget {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? REDIS_TIMEOUT_MS;
  const { store, capMicroUsd } = deps;
  let lastLogAt = Number.NEGATIVE_INFINITY;

  const guard = async <T>(call: Promise<T>): Promise<T> => {
    try {
      return await withTimeout(call, timeoutMs);
    } catch (error) {
      if (error instanceof RateLimitUnavailableError) throw error;
      throw new RateLimitUnavailableError(error instanceof Error ? error.name : "Redis");
    }
  };

  const logExhausted = (spentMicroUsd: number) => {
    const t = now().getTime();
    if (t - lastLogAt < LOG_EVERY_MS) return;
    lastLogAt = t;
    console.error(
      `[budget] apify потолок исчерпан: потрачено=${cents(spentMicroUsd)}ц потолок=${cents(capMicroUsd)}ц`,
    );
  };

  return {
    async hasRoom() {
      const spent = await guard(store.get(budgetKey(now())));
      const room = spent + APIFY_RESERVE_MICRO_USD <= capMicroUsd;
      if (!room) logExhausted(spent);
      return room;
    },

    async reserve() {
      const key = budgetKey(now());
      const total = await guard(store.add(key, APIFY_RESERVE_MICRO_USD, KEY_TTL_SECONDS));
      if (total > capMicroUsd) {
        // Откат нашей доли. Не удался — счётчик чуть завышен, это в сторону безопасности.
        await guard(store.add(key, -APIFY_RESERVE_MICRO_USD, KEY_TTL_SECONDS)).catch(() => {});
        logExhausted(total - APIFY_RESERVE_MICRO_USD);
        return null;
      }
      let settled = false;
      return {
        async settle(results) {
          if (settled) return;
          settled = true;
          const safe = Number.isFinite(results) && results > 0 ? Math.round(results) : 0;
          const delta = safe * APIFY_RESERVE_MICRO_USD - APIFY_RESERVE_MICRO_USD;
          if (delta === 0) return;
          try {
            await guard(store.add(key, delta, KEY_TTL_SECONDS));
          } catch (error) {
            // Резерв уже учтён; недоучёт разницы не роняет проверку.
            console.error(
              `[budget] не уточнили трату: ${error instanceof Error ? error.name : ""}`,
            );
          }
        },
      };
    },
  };
}

/** Хранилище на Upstash: INCRBY и EXPIRE одним конвейером. */
function redisStore(redis: Redis): CounterStore {
  return {
    async add(key, delta, ttlSeconds) {
      const [value] = await redis
        .pipeline()
        .incrby(key, delta)
        .expire(key, ttlSeconds)
        .exec<[number, number]>();
      return Number(value);
    },
    async get(key) {
      return Number((await redis.get<number>(key)) ?? 0);
    },
  };
}

/**
 * Боевой бюджет. Без Redis в env, как у лимитера: dev/test — пускаем, один раз пишем warn;
 * production — закрыто (`RateLimitUnavailableError`, вызывающий отвечает 503), потому что без
 * счётчика потолка нет.
 */
export function createDefaultApifyBudget(
  source: Record<string, string | undefined> = process.env,
  production = process.env.NODE_ENV === "production",
): ApifyBudget {
  const credentials = redisCredentials(parseServerEnv(source));
  if (!credentials) {
    if (production) {
      const closed = async (): Promise<never> => {
        console.error("[budget] Redis не настроен в production: платные проверки закрыты");
        throw new RateLimitUnavailableError("Redis не настроен");
      };
      return { hasRoom: closed, reserve: closed };
    }
    let warned = false;
    const warn = () => {
      if (warned) return;
      warned = true;
      console.warn("[budget] Redis не настроен: потолок Apify отключён (только dev)");
    };
    return {
      async hasRoom() {
        warn();
        return true;
      },
      async reserve() {
        warn();
        return { async settle() {} };
      },
    };
  }
  const redis = new Redis({ url: credentials.url, token: credentials.token });
  return createApifyBudget({
    store: redisStore(redis),
    capMicroUsd: apifyDailyCapMicroUsd(source),
  });
}

// Один бюджет на инстанс: клиент Redis и троттлинг лога не пересоздаются на каждый запрос.
let shared: ApifyBudget | undefined;
export function getApifyBudget(): ApifyBudget {
  shared ??= createDefaultApifyBudget();
  return shared;
}
