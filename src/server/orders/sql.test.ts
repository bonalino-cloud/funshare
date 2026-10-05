import { drizzle } from "drizzle-orm/neon-http";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  db: () => ({ execute }),
}));

import {
  createOrderRepository,
  DuplicateOrderError,
  findPromoQuery,
  redeemSql,
  releaseSql,
  trialSql,
} from "./repository";
import { schema } from "../db";
import { NOW } from "./test-helpers";

const dialect = new PgDialect();
const render = (query: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(query);
/** Без пробельных различий: проверяем состав условий, а не отступы. */
const flat = (text: string) => text.replace(/\s+/g, " ").replace(/\( /g, "(").trim();

const base = {
  generationId: "gen-1",
  tier: 2 as const,
  listAmount: 9900,
  discountAmount: 9900,
  finalAmount: 0,
  ownerTokenHash: "owner-h",
  ipHash: "ip-h",
  now: NOW,
};

describe("redeemSql: списание кода одной командой", () => {
  const redeem = { ...base, promoCode: "FREE100", percentOff: 100 };
  const { sql: text, params } = render(redeemSql(redeem));
  const q = flat(text);

  it("одна команда (CTE), без точки с запятой и без BEGIN/COMMIT", () => {
    expect(q.startsWith("WITH promo AS (UPDATE promo_codes SET redeemed = redeemed + 1")).toBe(
      true,
    );
    expect(q).not.toContain(";");
    expect(q).not.toMatch(/BEGIN|COMMIT/i);
  });

  it("счётчик растёт только при redeemed < max_redemptions, active и в окне", () => {
    expect(q).toContain("redeemed < max_redemptions");
    expect(q).toContain("AND active");
    expect(q).toContain("valid_from IS NULL OR valid_from <=");
    expect(q).toContain("valid_until IS NULL OR valid_until >");
    expect(q).toContain("= ANY(tiers)");
    expect(q).toContain("percent_off =");
    expect(q).toContain("RETURNING id");
  });

  it("лимиты на человека: по устройству и по IP, только неосвобождённые", () => {
    expect(q).toContain("per_device_limit IS NULL OR (SELECT count(*) FROM promo_redemptions r");
    expect(q).toContain("r.owner_token_hash =");
    expect(q).toContain("per_ip_limit IS NULL OR (SELECT count(*) FROM promo_redemptions r");
    expect(q).toContain("r.ip_hash =");
    expect(q.match(/r\.released_at IS NULL/g)).toHaveLength(2);
    expect(q).toContain("< per_device_limit");
    expect(q).toContain("< per_ip_limit");
  });

  it("заказ и использование вставляются из строки promo: нет строки promo - нет и заказа", () => {
    expect(q).toContain("INSERT INTO orders");
    expect(q).toContain("FROM promo RETURNING id");
    expect(q).toContain("INSERT INTO promo_redemptions");
    expect(q).toContain("FROM promo, ord RETURNING order_id");
    expect(q).toContain("'promo_free'::order_reason");
  });

  it("значения идут параметрами, а не текстом (ни код, ни хэши в SQL не вшиты)", () => {
    expect(text).not.toContain("FREE100");
    expect(text).not.toContain("owner-h");
    expect(params).toEqual(expect.arrayContaining(["FREE100", 100, "owner-h", "ip-h", "gen-1"]));
  });
});

describe("findPromoQuery: код и счётчики человека одной командой", () => {
  const { sql: text, params } = findPromoQuery(drizzle.mock({ schema }), "FREE100", {
    ownerTokenHash: "owner-h",
    ipHash: "ip-h",
  }).toSQL();
  const q = flat(text);

  it("один SELECT с подзапросами по неосвобождённым использованиям", () => {
    expect(q.startsWith("select")).toBe(true);
    expect(q.match(/SELECT count\(\*\) FROM promo_redemptions r/g)).toHaveLength(2);
    // Связь с внешней строкой — по promo_codes.id, а не по голому "id" (внутри это был бы r.id).
    expect(q.match(/r\.promo_id = promo_codes\.id/g)).toHaveLength(2);
    expect(q.match(/r\.released_at IS NULL/g)).toHaveLength(2);
    expect(q).toContain("r.owner_token_hash =");
    expect(q).toContain("r.ip_hash =");
  });

  it("код и хэши идут параметрами", () => {
    expect(text).not.toContain("FREE100");
    expect(text).not.toContain("owner-h");
    expect(params).toEqual(expect.arrayContaining(["FREE100", "owner-h", "ip-h"]));
  });
});

describe("trialSql: проба Поджога", () => {
  const { sql: text } = render(
    trialSql({ ...base, tier: 1, listAmount: 0, discountAmount: 0, finalAmount: 0, maxPerIp: 3 }),
  );
  const q = flat(text);

  it("гонку двух проб закрывает ON CONFLICT по частичному уникальному индексу устройства", () => {
    expect(q).toContain(
      "ON CONFLICT (owner_token_hash) WHERE reason = 'first_free' AND status <> 'voided' DO NOTHING",
    );
    expect(q).toContain("'first_free'::order_reason");
  });

  it("потолок проб на IP считает только неосвобождённые", () => {
    expect(q).toContain("o.ip_hash =");
    expect(q).toContain("o.reason = 'first_free' AND o.status <> 'voided'");
  });
});

describe("releaseSql: освобождение идемпотентно по построению", () => {
  const q = flat(render(releaseSql("order-1", NOW)).sql);

  it("заказ переводится в voided только из free/created, дальше цепочка зависит от этого", () => {
    expect(q).toContain("UPDATE orders SET status = 'voided'");
    expect(q).toContain("status IN ('free', 'created')");
    expect(q).toContain("WHERE order_id IN (SELECT id FROM ord)");
  });

  it("использование освобождается один раз (released_at IS NULL), счётчик уменьшается только за него", () => {
    expect(q).toContain("released_at IS NULL");
    expect(q).toContain("UPDATE promo_codes SET redeemed = redeemed - 1");
    expect(q).toContain("WHERE id IN (SELECT promo_id FROM red) AND redeemed > 0");
  });
});

describe("репозиторий: ошибки и разбор ответа", () => {
  it("повтор той же generationId (23505) -> DuplicateOrderError, а не успех", async () => {
    const repo = createOrderRepository();
    execute.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    await expect(
      repo.redeemAndCreateOrder({ ...base, promoCode: "X", percentOff: 100 }),
    ).rejects.toBeInstanceOf(DuplicateOrderError);
    // drizzle оборачивает ошибку драйвера в cause
    execute.mockRejectedValueOnce(new Error("wrapped", { cause: { code: "23505" } }));
    await expect(repo.createTrialOrder({ ...base, maxPerIp: 3 })).rejects.toBeInstanceOf(
      DuplicateOrderError,
    );
  });

  it("прочие ошибки БД пробрасываются как есть", async () => {
    const repo = createOrderRepository();
    execute.mockRejectedValueOnce(new Error("connection reset"));
    await expect(repo.release("o", NOW)).rejects.toThrow("connection reset");
  });

  it("0 строк от UPDATE = код не списан (null), строка = id заказа", async () => {
    const repo = createOrderRepository();
    execute.mockResolvedValueOnce({ rows: [] });
    expect(
      await repo.redeemAndCreateOrder({ ...base, promoCode: "X", percentOff: 100 }),
    ).toBeNull();
    execute.mockResolvedValueOnce({ rows: [{ order_id: "order-9" }] });
    expect(await repo.redeemAndCreateOrder({ ...base, promoCode: "X", percentOff: 100 })).toBe(
      "order-9",
    );
  });

  it("release: voided = 0 -> false (повтор), 1 -> true", async () => {
    const repo = createOrderRepository();
    execute.mockResolvedValueOnce({ rows: [{ voided: 0 }] });
    expect(await repo.release("o", NOW)).toBe(false);
    execute.mockResolvedValueOnce({ rows: [{ voided: 1 }] });
    expect(await repo.release("o", NOW)).toBe(true);
  });
});
