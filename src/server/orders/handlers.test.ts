import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pricing, Quote } from "@/contracts";
import { hashValue } from "../hash";
import { RateLimitUnavailableError } from "../ratelimit";
import { getPricing, postQuote } from "./handlers";
import { makeGuard, makePromo, makeRepo, NOW, OTHER_TOKEN, request, TOKEN } from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function setup(promos = {}, allowed = true) {
  const r = makeRepo(promos);
  const g = makeGuard(allowed);
  return { ...r, ...g, deps: { repo: r.repo, guard: g.guard, now: () => NOW } };
}

const quote = (
  t: ReturnType<typeof setup>,
  body: unknown,
  init: { token?: string; ip?: string } = {},
) => postQuote(request("POST", "/api/quotes", body, init), t.deps);

describe("GET /api/pricing", () => {
  it("три тарифа, проба доступна новому устройству; no-store, cookie не ставит", async () => {
    const t = setup();
    const res = await getPricing(request("GET", "/api/pricing"), t.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = Pricing.parse(await res.json());
    expect(body.freeTrialAvailable).toBe(true);
    expect(body.tiers.map((x) => [x.tier, x.listAmount, x.available])).toEqual([
      [1, 0, true],
      [2, 9900, true],
      [3, 0, false],
    ]);
  });

  it("после пробы freeTrialAvailable = false для этого устройства, у другого true", async () => {
    const t = setup();
    await t.repo.createTrialOrder({
      generationId: "g",
      tier: 1,
      listAmount: 0,
      discountAmount: 0,
      finalAmount: 0,
      ownerTokenHash: hashValue("owner", TOKEN),
      ipHash: hashValue("ip", "1.1.1.1"),
      now: NOW,
      maxPerIp: 3,
    });
    const mine = await getPricing(
      request("GET", "/api/pricing", undefined, { token: TOKEN, ip: "9.9.9.9" }),
      t.deps,
    );
    expect(Pricing.parse(await mine.json()).freeTrialAvailable).toBe(false);
    const other = await getPricing(
      request("GET", "/api/pricing", undefined, { token: OTHER_TOKEN, ip: "9.9.9.9" }),
      t.deps,
    );
    expect(Pricing.parse(await other.json()).freeTrialAvailable).toBe(true);
  });

  it("сбой БД -> 500 internal без деталей", async () => {
    const t = setup();
    t.repo.trialUsage.mockRejectedValueOnce(new Error("secret dsn"));
    const res = await getPricing(request("GET", "/api/pricing"), t.deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ errorCode: "internal" });
  });
});

describe("POST /api/quotes", () => {
  it("без кода: полная цена, лимитер не трогаем", async () => {
    const t = setup();
    const res = await quote(t, { tier: 2 });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Quote.parse(await res.json())).toMatchObject({ finalAmount: 9900 });
    expect(t.enter).not.toHaveBeenCalled();
  });

  it("с кодом: цена пересчитана, ничего не потрачено", async () => {
    const t = setup({ HALF: makePromo({ percentOff: 50 }) });
    const res = await quote(t, { tier: 2, promoCode: "half" }, { token: TOKEN });
    expect(Quote.parse(await res.json())).toMatchObject({
      finalAmount: 4950,
      promo: { percentOff: 50 },
    });
    expect(t.codes.get("HALF")?.redeemed).toBe(0);
    expect(t.fail).not.toHaveBeenCalled();
  });

  it("неверный, просроченный и исчерпанный код отвечают одинаково", async () => {
    const day = 86_400_000;
    const t = setup({
      OLD: makePromo({ validUntil: new Date(NOW.getTime() - day) }),
      FULL: makePromo({ id: "p2", redeemed: 1, maxRedemptions: 1 }),
      OFF: makePromo({ id: "p3", active: false }),
    });
    const bodies = [];
    for (const promoCode of ["nope", "old", "full", "off"]) {
      const res = await quote(t, { tier: 2, promoCode });
      expect(res.status).toBe(400);
      bodies.push(await res.json());
    }
    for (const b of bodies) expect(b).toEqual({ errorCode: "promo_invalid" });
  });

  it("неверная попытка записывается в лимит, верная нет", async () => {
    const t = setup({ HALF: makePromo({ percentOff: 50 }) });
    await quote(t, { tier: 2, promoCode: "half" });
    expect(t.fail).not.toHaveBeenCalled();
    await quote(t, { tier: 2, promoCode: "nope" });
    expect(t.fail).toHaveBeenCalledTimes(1);
  });

  it("лимит перебора исчерпан -> 429 rate_limited, код не проверяется", async () => {
    const t = setup({ HALF: makePromo({ percentOff: 50 }) }, false);
    const res = await quote(t, { tier: 2, promoCode: "half" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ errorCode: "rate_limited" });
    expect(t.repo.findPromo).not.toHaveBeenCalled();
  });

  it("в лимитер уходят хэши, а не сырые IP и токен", async () => {
    const t = setup();
    await quote(t, { tier: 2, promoCode: "x" }, { token: TOKEN, ip: "5.6.7.8" });
    const [arg] = t.enter.mock.calls[0] ?? [];
    expect(arg).toEqual({
      ipHash: hashValue("ip", "5.6.7.8"),
      ownerHash: hashValue("owner", TOKEN),
    });
    expect(JSON.stringify(arg)).not.toContain("5.6.7.8");
  });

  it("лимитер недоступен (Redis) -> 503, закрыто", async () => {
    const t = setup();
    t.enter.mockRejectedValueOnce(new RateLimitUnavailableError("Redis"));
    const res = await quote(t, { tier: 2, promoCode: "x" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ errorCode: "internal" });
    expect(t.repo.findPromo).not.toHaveBeenCalled();
  });

  it("Пекло -> 400 tier_unavailable, не бесплатная цена", async () => {
    const t = setup();
    const res = await quote(t, { tier: 3 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errorCode: "tier_unavailable" });
  });

  it("Поджог после использованной пробы -> 409 free_used", async () => {
    const t = setup();
    await t.repo.createTrialOrder({
      generationId: "g",
      tier: 1,
      listAmount: 0,
      discountAmount: 0,
      finalAmount: 0,
      ownerTokenHash: hashValue("owner", TOKEN),
      ipHash: "x",
      now: NOW,
      maxPerIp: 3,
    });
    const res = await quote(t, { tier: 1 }, { token: TOKEN });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ errorCode: "free_used" });
  });

  it.each([
    ["не JSON", "{oops", "invalid_request"],
    ["нет tier", {}, "invalid_request"],
    ["tier вне 1-3", { tier: 9 }, "invalid_request"],
    ["код не строка", { tier: 2, promoCode: 5 }, "invalid_request"],
    ["плохой tier и длинный код", { tier: 9, promoCode: "A".repeat(41) }, "invalid_request"],
    ["пустой код", { tier: 2, promoCode: "  " }, "promo_invalid"],
    ["слишком длинный код", { tier: 2, promoCode: "A".repeat(41) }, "promo_invalid"],
  ])("%s -> 400 %s без обращения к БД и лимитеру", async (_name, body, errorCode) => {
    const t = setup();
    const res = await quote(t, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errorCode });
    expect(t.enter).not.toHaveBeenCalled();
    expect(t.repo.findPromo).not.toHaveBeenCalled();
  });

  it("цену клиент не задаёт: лишние поля в теле игнорируются", async () => {
    const t = setup();
    const res = await quote(t, { tier: 2, listAmount: 1, finalAmount: 0, percentOff: 100 });
    expect(Quote.parse(await res.json()).finalAmount).toBe(9900);
  });

  it("сбой БД -> 500 internal, текст ошибки и код в логи не попадают", async () => {
    const t = setup();
    t.repo.findPromo.mockRejectedValueOnce(new Error("pg://user:pass@host SECRETCODE"));
    const res = await quote(t, { tier: 2, promoCode: "SECRETCODE" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ errorCode: "internal" });
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).not.toContain("SECRETCODE");
    expect(logged).not.toContain("pass");
  });
});
