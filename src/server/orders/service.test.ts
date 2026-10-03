import { describe, expect, it } from "vitest";
import { FREE_TRIAL_PER_IP } from "../pricing";
import { TierUnavailableError } from "../pricing";
import { checkPromo, createOrder, isFreeTrialAvailable, quoteFor, releaseOrder } from "./service";
import { makePromo, makeRepo, NOW, person } from "./test-helpers";

const ctx = { ...person, tier: 2 as const, now: NOW };
const order = (over: Record<string, unknown> = {}) => ({
  generationId: "gen-1",
  tier: 2 as const,
  promoCode: "free-100",
  ownerTokenHash: person.ownerTokenHash,
  ipHash: person.ipHash,
  now: NOW,
  ...over,
});

describe("checkPromo: любая причина отказа одинакова (правило 6)", () => {
  const day = 24 * 60 * 60 * 1000;
  const bad: [string, Parameters<typeof makePromo>[0]][] = [
    ["выключен", { active: false }],
    ["не тот тариф", { tiers: [1] }],
    ["ещё не начался", { validFrom: new Date(NOW.getTime() + day) }],
    ["просрочен", { validUntil: new Date(NOW.getTime() - day) }],
    ["окно закрылось ровно сейчас", { validUntil: NOW }],
    ["исчерпан", { redeemed: 10, maxRedemptions: 10 }],
  ];

  it.each(bad)("%s -> { ok: false }", async (_name, over) => {
    const { repo } = makeRepo({ FREE100: makePromo(over) });
    expect(await checkPromo(repo, "free-100", ctx)).toEqual({ ok: false });
  });

  it("несуществующий код -> тот же { ok: false }", async () => {
    const { repo } = makeRepo();
    expect(await checkPromo(repo, "nope", ctx)).toEqual({ ok: false });
  });

  it("пустая после нормализации строка не доходит до БД", async () => {
    const { repo } = makeRepo();
    expect(await checkPromo(repo, " - - ", ctx)).toEqual({ ok: false });
    expect(repo.findPromo).not.toHaveBeenCalled();
  });

  it("код на тарифе с ценой 0 не принимается", async () => {
    const { repo } = makeRepo({ FREE100: makePromo({ tiers: [1, 2] }) });
    expect(await checkPromo(repo, "free-100", { ...ctx, tier: 1 })).toEqual({ ok: false });
  });

  it("годный код: нормализация регистра, дефисов, пробелов", async () => {
    const { repo } = makeRepo({ FREE100: makePromo() });
    expect(await checkPromo(repo, "  Free-100 ", ctx)).toEqual({
      ok: true,
      promo: { id: "promo-1", code: "FREE100", percentOff: 100 },
    });
  });

  it("окно: validFrom включительно, validUntil исключительно", async () => {
    const { repo } = makeRepo({ FREE100: makePromo({ validFrom: NOW }) });
    expect((await checkPromo(repo, "free100", ctx)).ok).toBe(true);
  });

  it("perDeviceLimit: достигнут для этого устройства, у других код работает", async () => {
    const { repo } = makeRepo({ FREE100: makePromo({ perDeviceLimit: 1 }) });
    expect((await createOrder(repo, order())).ok).toBe(true);
    expect(await checkPromo(repo, "free100", ctx)).toEqual({ ok: false });
    expect(
      (await checkPromo(repo, "free100", { ...ctx, ownerTokenHash: "owner-2", ipHash: "ip-2" })).ok,
    ).toBe(true);
  });

  it("perIpLimit: достигнут для этого IP, у другого IP код работает", async () => {
    const { repo } = makeRepo({ FREE100: makePromo({ perIpLimit: 1 }) });
    expect((await createOrder(repo, order())).ok).toBe(true);
    const sameIp = { ...ctx, ownerTokenHash: "owner-2" };
    expect(await checkPromo(repo, "free100", sameIp)).toEqual({ ok: false });
    expect((await checkPromo(repo, "free100", { ...sameIp, ipHash: "ip-2" })).ok).toBe(true);
  });

  it("освобождённое использование лимит человека не занимает", async () => {
    const { repo } = makeRepo({ FREE100: makePromo({ perDeviceLimit: 1 }) });
    const created = await createOrder(repo, order());
    if (!created.ok) throw new Error("ожидали заказ");
    await releaseOrder(repo, created.order.id, NOW);
    expect((await checkPromo(repo, "free100", ctx)).ok).toBe(true);
  });

  it("код с лимитами и несуществующий код — ровно одно обращение к БД (не различимы по времени)", async () => {
    const { repo } = makeRepo({ FREE100: makePromo({ perDeviceLimit: 2, perIpLimit: 4 }) });
    await checkPromo(repo, "free100", ctx);
    await checkPromo(repo, "nope", ctx);
    expect(repo.findPromo).toHaveBeenCalledTimes(2);
  });

  it("без cookie (ownerTokenHash = null) по устройству не считаем, по IP считаем", async () => {
    const { repo } = makeRepo({ FREE100: makePromo({ perIpLimit: 1 }) });
    await createOrder(repo, order());
    expect(await checkPromo(repo, "free100", { ...ctx, ownerTokenHash: null })).toEqual({
      ok: false,
    });
  });
});

describe("quoteFor: ничего не тратит", () => {
  it("Кострище без кода: полная цена, БД не трогаем", async () => {
    const { repo } = makeRepo();
    const result = await quoteFor(repo, { tier: 2 }, person, NOW);
    expect(result).toMatchObject({ ok: true, quote: { finalAmount: 9900 } });
    expect(repo.findPromo).not.toHaveBeenCalled();
  });

  it("код на 50 %: цена пересчитана, списания нет", async () => {
    const { repo, codes } = makeRepo({ HALF: makePromo({ percentOff: 50 }) });
    const result = await quoteFor(repo, { tier: 2, promoCode: "half" }, person, NOW);
    expect(result).toMatchObject({
      ok: true,
      quote: { finalAmount: 4950, discountAmount: 4950, promo: { code: "half", percentOff: 50 } },
    });
    expect(codes.get("HALF")?.redeemed).toBe(0);
    expect(repo.redeemAndCreateOrder).not.toHaveBeenCalled();
    expect(repo.createTrialOrder).not.toHaveBeenCalled();
  });

  it("неверный код -> promo_invalid", async () => {
    const { repo } = makeRepo();
    expect(await quoteFor(repo, { tier: 2, promoCode: "x" }, person, NOW)).toEqual({
      ok: false,
      errorCode: "promo_invalid",
    });
  });

  it("Поджог: проба доступна -> итог 0 с freeTrial, и пробу не занимает", async () => {
    const { repo, orders } = makeRepo();
    const result = await quoteFor(repo, { tier: 1 }, person, NOW);
    expect(result).toMatchObject({ ok: true, quote: { finalAmount: 0, freeTrial: true } });
    expect(orders).toHaveLength(0);
  });

  it("Поджог после использованной пробы -> free_used", async () => {
    const { repo } = makeRepo();
    await createOrder(repo, order({ tier: 1, promoCode: undefined }));
    expect(await quoteFor(repo, { tier: 1 }, person, NOW)).toEqual({
      ok: false,
      errorCode: "free_used",
    });
  });

  it("Поджог с кодом -> promo_invalid", async () => {
    const { repo } = makeRepo({ FREE100: makePromo({ tiers: [1, 2] }) });
    expect(await quoteFor(repo, { tier: 1, promoCode: "free100" }, person, NOW)).toEqual({
      ok: false,
      errorCode: "promo_invalid",
    });
  });

  it("Пекло недоступно: TierUnavailableError до обращения к БД", async () => {
    const { repo } = makeRepo({ FREE100: makePromo() });
    await expect(
      quoteFor(repo, { tier: 3, promoCode: "free100" }, person, NOW),
    ).rejects.toBeInstanceOf(TierUnavailableError);
    await expect(quoteFor(repo, { tier: 3 }, person, NOW)).rejects.toBeInstanceOf(
      TierUnavailableError,
    );
    expect(repo.findPromo).not.toHaveBeenCalled();
  });
});

describe("createOrder: код на 100 %", () => {
  it("списывает код, создаёт заказ free и использование", async () => {
    const { repo, codes, orders, redemptions } = makeRepo({ FREE100: makePromo() });
    const result = await createOrder(repo, order());
    expect(result).toMatchObject({
      ok: true,
      order: { generationId: "gen-1", reason: "promo_free", quote: { finalAmount: 0 } },
    });
    expect(codes.get("FREE100")?.redeemed).toBe(1);
    expect(orders).toHaveLength(1);
    expect(redemptions).toHaveLength(1);
  });

  it("в списание уходит нормализованный код и процент, по которому считали цену", async () => {
    const { repo } = makeRepo({ FREE100: makePromo() });
    await createOrder(repo, order({ promoCode: " Free 100 " }));
    expect(repo.redeemAndCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        promoCode: "FREE100",
        percentOff: 100,
        listAmount: 9900,
        discountAmount: 9900,
        finalAmount: 0,
      }),
    );
  });

  it("гонка за последнее использование: UPDATE вернул 0 строк -> promo_invalid, заказа нет", async () => {
    const { repo, orders, redemptions } = makeRepo({ FREE100: makePromo({ maxRedemptions: 1 }) });
    // Проверка прошла (код ещё свободен), но пока шли к списанию, последнее использование забрали.
    repo.redeemAndCreateOrder.mockResolvedValueOnce(null);
    expect(await createOrder(repo, order())).toEqual({ ok: false, errorCode: "promo_invalid" });
    expect(orders).toHaveLength(0);
    expect(redemptions).toHaveLength(0);
  });

  it("последний код: из двух заказов проходит один", async () => {
    const { repo, codes } = makeRepo({ FREE100: makePromo({ maxRedemptions: 1 }) });
    const [a, b] = await Promise.all([
      createOrder(repo, order({ generationId: "gen-a" })),
      createOrder(repo, order({ generationId: "gen-b", ownerTokenHash: "owner-2" })),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(codes.get("FREE100")?.redeemed).toBe(1);
  });

  it("сбой списания не оставляет следов: исключение наружу, счётчик не двигался", async () => {
    const { repo, codes } = makeRepo({ FREE100: makePromo() });
    repo.redeemAndCreateOrder.mockRejectedValueOnce(new Error("boom"));
    await expect(createOrder(repo, order())).rejects.toThrow("boom");
    expect(codes.get("FREE100")?.redeemed).toBe(0);
  });
});

describe("createOrder: платный итог", () => {
  it("без кода -> payment_required, заказ не создаётся", async () => {
    const { repo, orders } = makeRepo();
    expect(await createOrder(repo, order({ promoCode: undefined }))).toEqual({
      ok: false,
      errorCode: "payment_required",
    });
    expect(orders).toHaveLength(0);
  });

  it("код на 50 % -> payment_required, и код НЕ списывается", async () => {
    const { repo, codes, orders } = makeRepo({ HALF: makePromo({ percentOff: 50 }) });
    expect(await createOrder(repo, order({ promoCode: "half" }))).toEqual({
      ok: false,
      errorCode: "payment_required",
    });
    expect(codes.get("HALF")?.redeemed).toBe(0);
    expect(repo.redeemAndCreateOrder).not.toHaveBeenCalled();
    expect(orders).toHaveLength(0);
  });

  it("неверный код -> promo_invalid, а не payment_required", async () => {
    const { repo } = makeRepo();
    expect(await createOrder(repo, order({ promoCode: "x" }))).toEqual({
      ok: false,
      errorCode: "promo_invalid",
    });
  });

  it("Пекло недоступно, в БД не ходим", async () => {
    const { repo } = makeRepo({ FREE100: makePromo() });
    await expect(createOrder(repo, order({ tier: 3 }))).rejects.toBeInstanceOf(
      TierUnavailableError,
    );
    expect(repo.findPromo).not.toHaveBeenCalled();
    expect(repo.createTrialOrder).not.toHaveBeenCalled();
  });
});

describe("бесплатная проба Поджога (правило 3)", () => {
  const trial = (over: Record<string, unknown> = {}) =>
    order({ tier: 1, promoCode: undefined, ...over });

  it("первая проба: заказ free с причиной first_free", async () => {
    const { repo, orders } = makeRepo();
    const result = await createOrder(repo, trial());
    expect(result).toMatchObject({
      ok: true,
      order: { reason: "first_free", quote: { finalAmount: 0, freeTrial: true } },
    });
    expect(orders[0]).toMatchObject({ status: "free", reason: "first_free" });
  });

  it("повторная проба того же устройства -> free_used", async () => {
    const { repo } = makeRepo();
    await createOrder(repo, trial());
    expect(await createOrder(repo, trial({ generationId: "gen-2" }))).toEqual({
      ok: false,
      errorCode: "free_used",
    });
  });

  it("две одновременные пробы одного устройства: проходит одна", async () => {
    const { repo, orders } = makeRepo();
    const results = await Promise.all([
      createOrder(repo, trial({ generationId: "gen-a" })),
      createOrder(repo, trial({ generationId: "gen-b" })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(orders).toHaveLength(1);
  });

  it("новое устройство с того же IP: до потолка проб на IP проходит, потом free_used", async () => {
    const { repo } = makeRepo();
    for (let i = 0; i < FREE_TRIAL_PER_IP; i++) {
      const r = await createOrder(repo, trial({ generationId: `g${i}`, ownerTokenHash: `o${i}` }));
      expect(r.ok).toBe(true);
    }
    expect(await createOrder(repo, trial({ generationId: "gx", ownerTokenHash: "ox" }))).toEqual({
      ok: false,
      errorCode: "free_used",
    });
  });

  it("код на Поджоге не принимается и не списывается", async () => {
    const { repo, codes } = makeRepo({ FREE100: makePromo({ tiers: [1, 2] }) });
    expect(await createOrder(repo, trial({ promoCode: "free100" }))).toEqual({
      ok: false,
      errorCode: "promo_invalid",
    });
    expect(codes.get("FREE100")?.redeemed).toBe(0);
  });

  it("isFreeTrialAvailable отражает использованную пробу и не зависит от cookie-less IP-лимита", async () => {
    const { repo } = makeRepo();
    expect(await isFreeTrialAvailable(repo, person)).toBe(true);
    await createOrder(repo, trial());
    expect(await isFreeTrialAvailable(repo, person)).toBe(false);
    expect(await isFreeTrialAvailable(repo, { ownerTokenHash: "other", ipHash: "ip-9" })).toBe(
      true,
    );
  });
});

describe("releaseOrder: возврат при провале", () => {
  it("возвращает использование кода: redeemed - 1, releasedAt, заказ voided", async () => {
    const { repo, codes, orders, redemptions } = makeRepo({ FREE100: makePromo() });
    const created = await createOrder(repo, order());
    if (!created.ok) throw new Error("ожидали заказ");
    expect(await releaseOrder(repo, created.order.id, NOW)).toBe(true);
    expect(codes.get("FREE100")?.redeemed).toBe(0);
    expect(orders[0]?.status).toBe("voided");
    expect(redemptions[0]?.releasedAt).toEqual(NOW);
  });

  it("идемпотентен: повторный вызов не уменьшает счётчик второй раз", async () => {
    const { repo, codes } = makeRepo({ FREE100: makePromo({ redeemed: 3, maxRedemptions: 10 }) });
    const created = await createOrder(repo, order());
    if (!created.ok) throw new Error("ожидали заказ");
    expect(codes.get("FREE100")?.redeemed).toBe(4);
    expect(await releaseOrder(repo, created.order.id, NOW)).toBe(true);
    expect(await releaseOrder(repo, created.order.id, NOW)).toBe(false);
    expect(codes.get("FREE100")?.redeemed).toBe(3);
  });

  it("проба Поджога при провале возвращается человеку", async () => {
    const { repo } = makeRepo();
    const created = await createOrder(repo, order({ tier: 1, promoCode: undefined }));
    if (!created.ok) throw new Error("ожидали заказ");
    expect(await isFreeTrialAvailable(repo, person)).toBe(false);
    await releaseOrder(repo, created.order.id, NOW);
    expect(await isFreeTrialAvailable(repo, person)).toBe(true);
    expect(
      (await createOrder(repo, order({ tier: 1, promoCode: undefined, generationId: "gen-2" }))).ok,
    ).toBe(true);
  });

  it("неизвестный заказ: false, ничего не ломается", async () => {
    const { repo } = makeRepo();
    expect(await releaseOrder(repo, "nope", NOW)).toBe(false);
  });
});
