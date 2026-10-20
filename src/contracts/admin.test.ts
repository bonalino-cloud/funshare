import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGE_MAX,
  ADMIN_PROMO_BULK_MAX,
  AdminApiError,
  AdminAuditList,
  AdminAuditListQuery,
  AdminGenerationAction,
  AdminGenerationCard,
  AdminGenerationList,
  AdminGenerationListQuery,
  AdminLoginRequest,
  AdminPromoBulkCreateRequest,
  AdminPromoBulkCreateResponse,
  AdminPromoCode,
  AdminPromoCreateRequest,
  AdminPromoList,
  AdminPromoRedemptionList,
  AdminPromoUpdateRequest,
  AdminPunch,
  AdminSession,
  ErrorCode,
} from "./index";
import adminGenerations from "./fixtures/admin-generations.json";
import adminMisc from "./fixtures/admin-misc.json";
import adminPromo from "./fixtures/admin-promo.json";
import artifactRoast from "./fixtures/artifact-roast.json";
import personaRoast from "./fixtures/persona-roast.json";

describe("админка: фикстуры проходят схемы", () => {
  it("промокоды: код, запросы, использования", () => {
    expect(AdminPromoCode.parse(adminPromo.code).percentOff).toBe(100);
    expect(AdminPromoCreateRequest.parse(adminPromo.createRequest).code).toBeUndefined();
    expect(AdminPromoCreateRequest.parse(adminPromo.createNamedRequest).code).toBe("ПОГНАЛИ100");
    expect(AdminPromoUpdateRequest.parse(adminPromo.updateRequest).perIpLimit).toBeNull();
    expect(AdminPromoBulkCreateRequest.parse(adminPromo.bulkRequest).count).toBe(3);
    expect(AdminPromoRedemptionList.parse(adminPromo.redemptions).items).toHaveLength(2);
    const list = AdminPromoList.parse({ items: [adminPromo.code], nextCursor: null });
    expect(list.items).toHaveLength(1);
    const bulk = AdminPromoBulkCreateResponse.parse({ items: [adminPromo.code] });
    expect(bulk.items).toHaveLength(1);
  });

  it("генерации: query из строк приводится к типам, список, действия", () => {
    const q = AdminGenerationListQuery.parse(adminGenerations.listQuery);
    expect(q).toMatchObject({ tier: 2, needsReview: true, limit: 20, sort: "filtered_desc" });
    const empty = AdminGenerationListQuery.parse({});
    expect(empty).toMatchObject({ limit: 50, sort: "created_desc" });
    expect(AdminGenerationList.parse(adminGenerations.list).items).toHaveLength(2);
    for (const a of adminGenerations.actions) AdminGenerationAction.parse(a);
  });

  it("карточка: с настоящими артефактом и персоной, и без них", () => {
    const bare = AdminGenerationCard.parse(adminGenerations.card);
    expect(bare.artifact).toBeNull();
    const full = AdminGenerationCard.parse({
      ...adminGenerations.card,
      artifact: artifactRoast,
      persona: personaRoast,
    });
    expect(full.artifact?.kind).toBe("roast_v1");
    expect(full.persona).not.toBeNull();
    const noOrder = AdminGenerationCard.parse({
      ...adminGenerations.card,
      order: null,
      finalAmount: null,
      promoCode: null,
    });
    expect(noOrder.order).toBeNull();
  });

  it("вход, сессия, ошибка, аудит", () => {
    expect(AdminLoginRequest.parse(adminMisc.login).token).toBeTruthy();
    expect(AdminSession.parse(adminMisc.session).actor).toBe("foxawear-lab");
    expect(AdminApiError.parse(adminMisc.error).adminErrorCode).toBe("unauthorized");
    expect(AdminAuditList.parse(adminMisc.audit).items[0]?.action).toBe("promo.create");
    const q = AdminAuditListQuery.parse({ action: "promo", target: "promo_01" });
    expect(q).toMatchObject({ action: "promo", limit: 50 });
    expect(AdminAuditListQuery.safeParse({ action: " " }).success).toBe(false);
  });
});

describe("промокоды: отказы", () => {
  const base = adminPromo.createRequest;

  it("maxRedemptions обязателен, в том числе при 100 %", () => {
    const noMax: Record<string, unknown> = { ...base };
    delete noMax.maxRedemptions;
    expect(AdminPromoCreateRequest.safeParse(noMax).success).toBe(false);
    expect(AdminPromoCreateRequest.safeParse({ ...noMax, percentOff: 100 }).success).toBe(false);
    expect(AdminPromoCreateRequest.safeParse({ ...base, maxRedemptions: 0 }).success).toBe(false);
  });

  it("percentOff только 1–100, целый", () => {
    for (const percentOff of [0, 101, -5, 50.5]) {
      expect(AdminPromoCreateRequest.safeParse({ ...base, percentOff }).success).toBe(false);
    }
    expect(AdminPromoCreateRequest.safeParse({ ...base, percentOff: 1 }).success).toBe(true);
  });

  it("tiers: непустой, из 1–3, без повторов", () => {
    for (const tiers of [[], [4], [2, 2]]) {
      expect(AdminPromoCreateRequest.safeParse({ ...base, tiers }).success).toBe(false);
    }
  });

  it("лимиты должны быть положительными", () => {
    expect(AdminPromoCreateRequest.safeParse({ ...base, perIpLimit: 0 }).success).toBe(false);
    expect(AdminPromoCreateRequest.safeParse({ ...base, perDeviceLimit: null }).success).toBe(
      false,
    );
  });

  it("validFrom позже или равен validUntil — отказ", () => {
    const window = (validFrom: string, validUntil: string) => ({ ...base, validFrom, validUntil });
    const a = "2026-11-01T00:00:00.000Z";
    const b = "2026-12-01T00:00:00.000Z";
    expect(AdminPromoCreateRequest.safeParse(window(a, b)).success).toBe(true);
    expect(AdminPromoCreateRequest.safeParse(window(b, a)).success).toBe(false);
    expect(AdminPromoCreateRequest.safeParse(window(a, a)).success).toBe(false);
    expect(AdminPromoUpdateRequest.safeParse({ validFrom: b, validUntil: a }).success).toBe(false);
  });

  it("правка: пустая не проходит, одно поле проходит, null снимает значение", () => {
    expect(AdminPromoUpdateRequest.safeParse({}).success).toBe(false);
    expect(AdminPromoUpdateRequest.safeParse({ note: undefined }).success).toBe(false);
    expect(AdminPromoUpdateRequest.safeParse({ active: false }).success).toBe(true);
    expect(AdminPromoUpdateRequest.safeParse({ validUntil: null }).success).toBe(true);
    expect(AdminPromoUpdateRequest.safeParse({ maxRedemptions: 0 }).success).toBe(false);
    // процент и тарифы после создания не правятся
    expect(AdminPromoUpdateRequest.safeParse({ percentOff: 10 }).success).toBe(false);
  });

  it("массовое создание: потолок count и формат префикса", () => {
    const bulk = adminPromo.bulkRequest;
    const ok = (over: object) => AdminPromoBulkCreateRequest.safeParse({ ...bulk, ...over });
    expect(ok({ count: ADMIN_PROMO_BULK_MAX }).success).toBe(true);
    expect(ok({ count: ADMIN_PROMO_BULK_MAX + 1 }).success).toBe(false);
    expect(ok({ count: 0 }).success).toBe(false);
    for (const prefix of ["", "A", "ТЕСТ", "AB-CD", "TOOLONGPREFIX", "A B"]) {
      expect(ok({ prefix }).success, prefix).toBe(false);
    }
  });

  it("потолок размера страницы", () => {
    expect(AdminGenerationListQuery.safeParse({ limit: String(ADMIN_PAGE_MAX) }).success).toBe(
      true,
    );
    expect(AdminGenerationListQuery.safeParse({ limit: String(ADMIN_PAGE_MAX + 1) }).success).toBe(
      false,
    );
    expect(AdminGenerationListQuery.safeParse({ limit: "0" }).success).toBe(false);
  });
});

describe("генерации: отказы", () => {
  it("rerun только с confirm: true", () => {
    expect(AdminGenerationAction.safeParse({ action: "rerun" }).success).toBe(false);
    expect(AdminGenerationAction.safeParse({ action: "rerun", confirm: false }).success).toBe(
      false,
    );
    expect(AdminGenerationAction.safeParse({ action: "rerun", confirm: "true" }).success).toBe(
      false,
    );
    expect(AdminGenerationAction.safeParse({ action: "rerun", confirm: true }).success).toBe(true);
    expect(AdminGenerationAction.safeParse({ action: "explode" }).success).toBe(false);
  });

  it("query: неверные значения фильтров и перевёрнутый период", () => {
    const bad = (q: Record<string, string>) => AdminGenerationListQuery.safeParse(q).success;
    expect(bad({ tier: "4" })).toBe(false);
    expect(bad({ status: "nope" })).toBe(false);
    expect(bad({ sort: "random" })).toBe(false);
    expect(bad({ needsReview: "maybe" })).toBe(false);
    expect(bad({ from: "2026-10-05T00:00:00Z" })).toBe(false);
    expect(bad({ from: "2026-10-06", to: "2026-10-01" })).toBe(false);
    expect(bad({ from: "2026-10-01", to: "2026-10-01" })).toBe(true);
  });

  it("кандидат: selected и selectionPosition согласованы", () => {
    const [chosen, cut] = adminGenerations.card.punches;
    expect(AdminPunch.safeParse(chosen).success).toBe(true);
    expect(AdminPunch.safeParse(cut).success).toBe(true);
    expect(AdminPunch.safeParse({ ...chosen, selectionPosition: null }).success).toBe(false);
    expect(AdminPunch.safeParse({ ...cut, selectionPosition: 2 }).success).toBe(false);
    expect(AdminPunch.safeParse({ ...cut, rejectedBy: "someone" }).success).toBe(false);
  });

  it("карточка: заказ и итоги согласованы", () => {
    const card = adminGenerations.card;
    const ok = (over: object) => AdminGenerationCard.safeParse({ ...card, ...over }).success;
    expect(ok({ finalAmount: 9900 })).toBe(false);
    expect(ok({ promoCode: "OTHER" })).toBe(false);
    expect(ok({ order: null })).toBe(false);
    expect(ok({ order: { ...card.order, finalAmount: 100 }, finalAmount: 100 })).toBe(false);
    expect(ok({ costMicroUsd: 1 })).toBe(false);
  });

  it("трасса: data — любой объект, но не массив и не строка", () => {
    const card = adminGenerations.card;
    const withData = (data: unknown) =>
      AdminGenerationCard.safeParse({ ...card, traces: [{ ...card.traces[0], data }] }).success;
    expect(withData({ whatever: [1, { a: null }] })).toBe(true);
    expect(withData([])).toBe(false);
    expect(withData("текст")).toBe(false);
  });

  it("карточка: нельзя дробные копейки и дробные микро-USD", () => {
    const card = adminGenerations.card;
    expect(AdminGenerationCard.safeParse({ ...card, finalAmount: 99.5 }).success).toBe(false);
    expect(AdminGenerationCard.safeParse({ ...card, costMicroUsd: 1.5 }).success).toBe(false);
    expect(AdminGenerationCard.safeParse({ ...card, finalAmount: -1 }).success).toBe(false);
  });
});

describe("приватность и общий ErrorCode", () => {
  const secrets = { ownerTokenHash: "h1", ipHash: "h2", ownerToken: "t", rawProfile: { a: 1 } };

  it("хэши и токены из ответов отбрасываются", () => {
    const redemption = {
      ...adminPromo.redemptions.items[0],
      ...secrets,
    };
    const list = AdminPromoRedemptionList.parse({ items: [redemption], nextCursor: null });
    expect(list.items[0]).not.toHaveProperty("ownerTokenHash");
    expect(list.items[0]).not.toHaveProperty("ipHash");

    const card = AdminGenerationCard.parse({ ...adminGenerations.card, ...secrets });
    for (const key of Object.keys(secrets)) expect(card).not.toHaveProperty(key);

    const item = AdminGenerationList.parse({
      items: [{ ...adminGenerations.list.items[0], ...secrets }],
      nextCursor: null,
    }).items[0];
    for (const key of Object.keys(secrets)) expect(item).not.toHaveProperty(key);

    const code = AdminPromoCode.parse({ ...adminPromo.code, ...secrets });
    for (const key of Object.keys(secrets)) expect(code).not.toHaveProperty(key);
  });

  it("публичный ErrorCode не расширен кодами админки", () => {
    for (const c of ["unauthorized", "forbidden", "not_found", "conflict"]) {
      expect(ErrorCode.safeParse(c).success, c).toBe(false);
    }
  });
});
