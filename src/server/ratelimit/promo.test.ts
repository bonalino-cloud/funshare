import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitUnavailableError, type Limit } from ".";
import { composePromoGuard, createPromoGuard, PROMO_LIMITS, type PeekLimit } from "./promo";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const limit = (success = true): Limit & { limit: ReturnType<typeof vi.fn> } => ({
  limit: vi.fn(async () => ({ success })),
});
const peek = (remaining = 5): PeekLimit & { remaining: ReturnType<typeof vi.fn> } => ({
  ...limit(),
  remaining: vi.fn(async () => remaining),
});

function windows(over: { attempts?: [Limit, Limit]; failures?: [PeekLimit, PeekLimit] } = {}) {
  const [aIp, aOwner] = over.attempts ?? [limit(), limit()];
  const [fIp, fOwner] = over.failures ?? [peek(), peek()];
  return { attempts: { ip: aIp, owner: aOwner }, failures: { ip: fIp, owner: fOwner } };
}

it("лимиты по документу: 5 неверных за 10 минут", () => {
  expect(PROMO_LIMITS.failures).toEqual({ requests: 5, window: "10 m" });
});

describe("enter", () => {
  it("свободно -> true", async () => {
    const guard = composePromoGuard(windows());
    expect(await guard.enter({ ipHash: "h", ownerHash: "o" })).toBe(true);
  });

  it("окно неверных попыток по IP исчерпано -> false", async () => {
    const guard = composePromoGuard(windows({ failures: [peek(0), peek()] }));
    expect(await guard.enter({ ipHash: "h", ownerHash: "o" })).toBe(false);
  });

  it("окно неверных попыток по устройству исчерпано -> false", async () => {
    const guard = composePromoGuard(windows({ failures: [peek(), peek(0)] }));
    expect(await guard.enter({ ipHash: "h", ownerHash: "o" })).toBe(false);
  });

  it("проверка неверных ничего не тратит (только remaining)", async () => {
    const failures: [ReturnType<typeof peek>, ReturnType<typeof peek>] = [peek(), peek()];
    await composePromoGuard(windows({ failures })).enter({ ipHash: "h", ownerHash: "o" });
    expect(failures[0].limit).not.toHaveBeenCalled();
    expect(failures[1].limit).not.toHaveBeenCalled();
    expect(failures[0].remaining).toHaveBeenCalledWith("ip:h");
    expect(failures[1].remaining).toHaveBeenCalledWith("owner:o");
  });

  it("потолок «любых попыток» (ограничивает параллельный перебор) -> false", async () => {
    const guard = composePromoGuard(windows({ attempts: [limit(false), limit()] }));
    expect(await guard.enter({ ipHash: "h", ownerHash: "o" })).toBe(false);
  });

  it("без cookie считаем только IP", async () => {
    const owner = peek(0);
    const attemptsOwner = limit(false);
    const guard = composePromoGuard(
      windows({ attempts: [limit(), attemptsOwner], failures: [peek(), owner] }),
    );
    expect(await guard.enter({ ipHash: "h", ownerHash: null })).toBe(true);
    expect(owner.remaining).not.toHaveBeenCalled();
    expect(attemptsOwner.limit).not.toHaveBeenCalled();
  });

  it("сбой Redis -> RateLimitUnavailableError, а не пропуск", async () => {
    const broken: PeekLimit = {
      limit: async () => ({ success: true }),
      remaining: async () => {
        throw new Error("ECONNRESET");
      },
    };
    const guard = composePromoGuard(windows({ failures: [broken, peek()] }));
    await expect(guard.enter({ ipHash: "h", ownerHash: "o" })).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });

  it("зависший Redis -> по таймауту RateLimitUnavailableError", async () => {
    const hang: PeekLimit = {
      limit: async () => ({ success: true }),
      remaining: () => new Promise(() => {}),
    };
    const guard = composePromoGuard(windows({ failures: [hang, peek()] }), 10);
    await expect(guard.enter({ ipHash: "h", ownerHash: null })).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });
});

describe("fail: тратит окно неверных попыток", () => {
  it("по IP и по устройству", async () => {
    const failures: [ReturnType<typeof peek>, ReturnType<typeof peek>] = [peek(), peek()];
    await composePromoGuard(windows({ failures })).fail({ ipHash: "h", ownerHash: "o" });
    expect(failures[0].limit).toHaveBeenCalledWith("ip:h");
    expect(failures[1].limit).toHaveBeenCalledWith("owner:o");
  });

  it("сбой записи не бросает (ответ пользователю не ломаем), но пишет в лог", async () => {
    const broken: PeekLimit = {
      limit: async () => {
        throw new Error("down");
      },
      remaining: async () => 5,
    };
    const guard = composePromoGuard(windows({ failures: [broken, peek()] }));
    await expect(guard.fail({ ipHash: "h", ownerHash: null })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("createPromoGuard без Redis", () => {
  it("dev: пускает и один раз предупреждает", async () => {
    const guard = createPromoGuard({}, false);
    expect(await guard.enter({ ipHash: "h", ownerHash: null })).toBe(true);
    await guard.fail({ ipHash: "h", ownerHash: null });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("production: закрыто (enter бросает), а не открытая дверь", async () => {
    const guard = createPromoGuard({}, true);
    await expect(guard.enter({ ipHash: "h", ownerHash: null })).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });
});
