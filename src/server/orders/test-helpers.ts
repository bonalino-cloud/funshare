import { NextRequest } from "next/server";
import { vi } from "vitest";
import type { PromoGuard } from "../ratelimit/promo";
import type { OrderRepository, PromoRow, RedeemInput, TrialInput } from "./repository";

export const NOW = new Date("2026-10-03T12:00:00.000Z");
export const TOKEN = "A".repeat(43);
export const OTHER_TOKEN = "B".repeat(43);

export const person = { ownerTokenHash: "owner-1", ipHash: "ip-1" };

export function makePromo(over: Partial<PromoRow> = {}): PromoRow {
  return {
    id: "promo-1",
    percentOff: 100,
    tiers: [2],
    maxRedemptions: 10,
    redeemed: 0,
    perDeviceLimit: null,
    perIpLimit: null,
    validFrom: null,
    validUntil: null,
    active: true,
    ...over,
  };
}

type Order = {
  id: string;
  generationId: string;
  status: string;
  reason: string;
  owner: string;
  ip: string;
};
type Redemption = {
  orderId: string;
  promoId: string;
  owner: string;
  ip: string;
  releasedAt: Date | null;
};

/**
 * Репозиторий в памяти. Повторяет решения SQL (WHERE списания, уникальность пробы, идемпотентный
 * release), но не доказывает атомарность: она держится на одной SQL-команде (см. sql.test.ts).
 */
export function makeRepo(promos: Record<string, PromoRow> = {}) {
  const codes = new Map(Object.entries(promos));
  const orders: Order[] = [];
  const redemptions: Redemption[] = [];
  let n = 0;
  const live = (r: Redemption) => r.releasedAt === null;

  const repo = {
    findPromo: vi.fn<OrderRepository["findPromo"]>(async (code, p) => {
      const row = codes.get(code);
      if (!row) return null;
      const mine = redemptions.filter((r) => r.promoId === row.id && live(r));
      return {
        ...row,
        usage: {
          device: mine.filter((r) => r.owner === p.ownerTokenHash).length,
          ip: mine.filter((r) => r.ip === p.ipHash).length,
        },
      };
    }),
    trialUsage: vi.fn<OrderRepository["trialUsage"]>(async (p) => {
      const trials = orders.filter((o) => o.reason === "first_free" && o.status !== "voided");
      return {
        device: trials.filter((o) => o.owner === p.ownerTokenHash).length,
        ip: trials.filter((o) => o.ip === p.ipHash).length,
      };
    }),
    redeemAndCreateOrder: vi.fn<OrderRepository["redeemAndCreateOrder"]>(async (i: RedeemInput) => {
      const row = codes.get(i.promoCode);
      if (!row || !row.active || row.redeemed >= row.maxRedemptions) return null;
      if (row.percentOff !== i.percentOff || !row.tiers.includes(i.tier)) return null;
      if (orders.some((o) => o.generationId === i.generationId)) throw new Error("duplicate");
      row.redeemed += 1;
      const id = `order-${++n}`;
      orders.push({
        id,
        generationId: i.generationId,
        status: "free",
        reason: "promo_free",
        owner: i.ownerTokenHash,
        ip: i.ipHash,
      });
      redemptions.push({
        orderId: id,
        promoId: row.id,
        owner: i.ownerTokenHash,
        ip: i.ipHash,
        releasedAt: null,
      });
      return id;
    }),
    createTrialOrder: vi.fn<OrderRepository["createTrialOrder"]>(async (i: TrialInput) => {
      const trials = orders.filter((o) => o.reason === "first_free" && o.status !== "voided");
      if (trials.some((o) => o.owner === i.ownerTokenHash)) return null;
      if (trials.filter((o) => o.ip === i.ipHash).length >= i.maxPerIp) return null;
      const id = `order-${++n}`;
      orders.push({
        id,
        generationId: i.generationId,
        status: "free",
        reason: "first_free",
        owner: i.ownerTokenHash,
        ip: i.ipHash,
      });
      return id;
    }),
    release: vi.fn<OrderRepository["release"]>(async (orderId, now) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order || !["free", "created"].includes(order.status)) return false;
      order.status = "voided";
      for (const r of redemptions.filter((x) => x.orderId === orderId && live(x))) {
        r.releasedAt = now;
        const row = [...codes.values()].find((c) => c.id === r.promoId);
        if (row && row.redeemed > 0) row.redeemed -= 1;
      }
      return true;
    }),
    orderIdFor: vi.fn<OrderRepository["orderIdFor"]>(
      async (generationId) => orders.find((o) => o.generationId === generationId)?.id ?? null,
    ),
  } satisfies OrderRepository;
  return { repo, codes, orders, redemptions };
}

/** Лимитер-фейк: пускает, если не сказано иное. */
export function makeGuard(allowed = true) {
  const enter = vi.fn<PromoGuard["enter"]>(async () => allowed);
  const fail = vi.fn<PromoGuard["fail"]>(async () => {});
  return { guard: { enter, fail } satisfies PromoGuard, enter, fail };
}

export function request(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  init: { token?: string; ip?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.token) headers.set("cookie", `ownerToken=${init.token}`);
  if (init.ip) headers.set("x-real-ip", init.ip);
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
