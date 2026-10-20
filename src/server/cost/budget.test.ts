import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitUnavailableError } from "../ratelimit";
import {
  APIFY_RESERVE_MICRO_USD as UNIT,
  apifyDailyCapMicroUsd,
  budgetKey,
  createApifyBudget,
  createDefaultApifyBudget,
  type CounterStore,
} from "./budget";

/** Счётчик в памяти; операции синхронны внутри, как атомарный INCRBY. */
function fakeStore() {
  const data = new Map<string, number>();
  const ttls: number[] = [];
  const store: CounterStore = {
    async add(key, delta, ttl) {
      ttls.push(ttl);
      const next = (data.get(key) ?? 0) + delta;
      data.set(key, next);
      return next;
    },
    async get(key) {
      return data.get(key) ?? 0;
    },
  };
  return { store, data, ttls };
}

const DAY1 = new Date("2026-10-20T10:00:00.000Z");
const DAY2 = new Date("2026-10-21T00:00:01.000Z");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("apifyDailyCapMicroUsd", () => {
  it("по умолчанию $5", () => {
    expect(apifyDailyCapMicroUsd({})).toBe(5_000_000);
    expect(apifyDailyCapMicroUsd({ APIFY_DAILY_BUDGET_USD: "" })).toBe(5_000_000);
  });
  it("задано число: берём", () => {
    expect(apifyDailyCapMicroUsd({ APIFY_DAILY_BUDGET_USD: "2.5" })).toBe(2_500_000);
    expect(apifyDailyCapMicroUsd({ APIFY_DAILY_BUDGET_USD: " 10 " })).toBe(10_000_000);
  });
  it("0 это выключатель Apify, а не «без потолка»", () => {
    expect(apifyDailyCapMicroUsd({ APIFY_DAILY_BUDGET_USD: "0" })).toBe(0);
  });
  it.each(["abc", "-3", "Infinity", "NaN", "1e9", "5$"])("кривое %j: 5 и строка в лог", (bad) => {
    expect(apifyDailyCapMicroUsd({ APIFY_DAILY_BUDGET_USD: bad })).toBe(5_000_000);
    expect(console.error).toHaveBeenCalledOnce();
  });
});

describe("ключ суток", () => {
  it("по UTC-дате", () => {
    expect(budgetKey(new Date("2026-10-20T23:59:59.999Z"))).toBe("budget:apify:2026-10-20");
    expect(budgetKey(DAY2)).toBe("budget:apify:2026-10-21");
  });
});

describe("резерв и откат", () => {
  it("резервирует цену результата и ставит TTL 48 ч", async () => {
    const { store, data, ttls } = fakeStore();
    const budget = createApifyBudget({ store, capMicroUsd: UNIT * 10, now: () => DAY1 });
    expect(await budget.reserve()).not.toBeNull();
    expect(data.get(budgetKey(DAY1))).toBe(UNIT);
    expect(ttls).toEqual([172_800]);
  });

  it("за потолком: отказ и откат, счётчик не растёт", async () => {
    const { store, data } = fakeStore();
    const budget = createApifyBudget({ store, capMicroUsd: UNIT * 2, now: () => DAY1 });
    expect(await budget.reserve()).not.toBeNull();
    expect(await budget.reserve()).not.toBeNull();
    expect(await budget.reserve()).toBeNull();
    expect(await budget.reserve()).toBeNull();
    expect(data.get(budgetKey(DAY1))).toBe(UNIT * 2);
  });

  it("лог при упоре: потрачено и потолок в центах", async () => {
    const { store } = fakeStore();
    const budget = createApifyBudget({ store, capMicroUsd: 5_000_000, now: () => DAY1 });
    await store.add(budgetKey(DAY1), 5_000_000 - UNIT + 1, 1);
    await budget.reserve();
    expect(console.error).toHaveBeenCalledWith(
      "[budget] apify потолок исчерпан: потрачено=500ц потолок=500ц",
    );
  });

  it("лог не чаще раза в минуту", async () => {
    const { store } = fakeStore();
    let t = DAY1.getTime();
    const budget = createApifyBudget({ store, capMicroUsd: 0, now: () => new Date(t) });
    await budget.reserve();
    await budget.reserve();
    expect(console.error).toHaveBeenCalledTimes(1);
    t += 61_000;
    await budget.reserve();
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("потолок 0: всё отказывает", async () => {
    const { store } = fakeStore();
    const budget = createApifyBudget({ store, capMicroUsd: 0, now: () => DAY1 });
    expect(await budget.reserve()).toBeNull();
    expect(await budget.hasRoom()).toBe(false);
  });
});

describe("settle", () => {
  it("1 результат без записи; 0 возвращает резерв; 3 доначисляет разницу", async () => {
    for (const [results, spent] of [
      [1, UNIT],
      [0, 0],
      [3, UNIT * 3],
    ] as const) {
      const { store, data } = fakeStore();
      const budget = createApifyBudget({ store, capMicroUsd: UNIT * 100, now: () => DAY1 });
      const lease = await budget.reserve();
      await lease?.settle(results);
      expect(data.get(budgetKey(DAY1))).toBe(spent);
    }
  });

  it("повторный settle ничего не меняет", async () => {
    const { store, data } = fakeStore();
    const budget = createApifyBudget({ store, capMicroUsd: UNIT * 100, now: () => DAY1 });
    const lease = await budget.reserve();
    await lease?.settle(3);
    await lease?.settle(3);
    expect(data.get(budgetKey(DAY1))).toBe(UNIT * 3);
  });

  it("settle после полуночи пишет в сутки резерва", async () => {
    const { store, data } = fakeStore();
    let now = DAY1;
    const budget = createApifyBudget({ store, capMicroUsd: UNIT * 100, now: () => now });
    const lease = await budget.reserve();
    now = DAY2;
    await lease?.settle(2);
    expect(data.get(budgetKey(DAY1))).toBe(UNIT * 2);
    expect(data.get(budgetKey(DAY2))).toBeUndefined();
  });

  it("сбой Redis при settle не бросает", async () => {
    const { store } = fakeStore();
    const budget = createApifyBudget({ store, capMicroUsd: UNIT * 100, now: () => DAY1 });
    const lease = await budget.reserve();
    store.add = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(lease?.settle(5)).resolves.toBeUndefined();
  });

  it("результаты переполняют потолок: следующий резерв отказывает", async () => {
    const { store } = fakeStore();
    const budget = createApifyBudget({ store, capMicroUsd: UNIT * 2, now: () => DAY1 });
    const lease = await budget.reserve();
    await lease?.settle(5);
    expect(await budget.reserve()).toBeNull();
  });
});

describe("конкуренция", () => {
  it("20 параллельных при остатке на 1: ровно один проходит, счётчик равен потолку", async () => {
    const { store, data } = fakeStore();
    const budget = createApifyBudget({ store, capMicroUsd: UNIT * 5, now: () => DAY1 });
    await store.add(budgetKey(DAY1), UNIT * 4, 1);
    const leases = await Promise.all(Array.from({ length: 20 }, () => budget.reserve()));
    expect(leases.filter((l) => l !== null)).toHaveLength(1);
    expect(data.get(budgetKey(DAY1))).toBe(UNIT * 5);
  });
});

describe("смена суток", () => {
  it("новые сутки: счётчик с нуля", async () => {
    const { store } = fakeStore();
    let now = DAY1;
    const budget = createApifyBudget({ store, capMicroUsd: UNIT, now: () => now });
    expect(await budget.reserve()).not.toBeNull();
    expect(await budget.reserve()).toBeNull();
    expect(await budget.hasRoom()).toBe(false);
    now = DAY2;
    expect(await budget.hasRoom()).toBe(true);
    expect(await budget.reserve()).not.toBeNull();
  });
});

describe("hasRoom", () => {
  it("только читает: ничего не резервирует", async () => {
    const { store, data } = fakeStore();
    const budget = createApifyBudget({ store, capMicroUsd: UNIT * 2, now: () => DAY1 });
    expect(await budget.hasRoom()).toBe(true);
    expect(data.size).toBe(0);
    await store.add(budgetKey(DAY1), UNIT + 1, 1);
    expect(await budget.hasRoom()).toBe(false); // осталось меньше одного результата
  });
});

describe("Redis недоступен", () => {
  it("ошибка или таймаут: RateLimitUnavailableError", async () => {
    const broken: CounterStore = {
      add: () => Promise.reject(new Error("net")),
      get: () => new Promise(() => {}),
    };
    const budget = createApifyBudget({
      store: broken,
      capMicroUsd: UNIT,
      now: () => DAY1,
      timeoutMs: 10,
    });
    await expect(budget.reserve()).rejects.toBeInstanceOf(RateLimitUnavailableError);
    await expect(budget.hasRoom()).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });

  it("production без Redis в env: закрыто", async () => {
    const budget = createDefaultApifyBudget({}, true);
    await expect(budget.reserve()).rejects.toBeInstanceOf(RateLimitUnavailableError);
    await expect(budget.hasRoom()).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });

  it("dev без Redis: пускает, предупреждение одно", async () => {
    const budget = createDefaultApifyBudget({}, false);
    const lease = await budget.reserve();
    expect(lease).not.toBeNull();
    await expect(lease?.settle(3)).resolves.toBeUndefined();
    expect(await budget.hasRoom()).toBe(true);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
