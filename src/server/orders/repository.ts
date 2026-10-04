import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Tier } from "@/contracts";
import { db, schema } from "../db";

/** Код как он лежит в БД. Ничего из этого наружу не уходит. */
export type PromoRow = {
  id: string;
  percentOff: number;
  tiers: number[];
  maxRedemptions: number;
  redeemed: number;
  perDeviceLimit: number | null;
  perIpLimit: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  active: boolean;
};

/** Сколько проб/неосвобождённых использований уже на этом устройстве и на этом IP. */
export type Usage = { device: number; ip: number };

export type Person = {
  /** `null` — у человека нет cookie: по устройству считать нечего. */
  ownerTokenHash: string | null;
  ipHash: string;
};

export type OrderAmounts = {
  generationId: string;
  tier: Tier;
  listAmount: number;
  discountAmount: number;
  finalAmount: number;
};

/** Заказ с кодом на 100 %. `promoCode` — нормализованный; `percentOff` — тот, по которому считали цену. */
export type RedeemInput = OrderAmounts & {
  promoCode: string;
  percentOff: number;
  ownerTokenHash: string;
  ipHash: string;
  now: Date;
};

export type TrialInput = OrderAmounts & {
  ownerTokenHash: string;
  ipHash: string;
  now: Date;
  /** Потолок проб на IP (по устройству — одна, её держит уникальный индекс). */
  maxPerIp: number;
};

/** Заказ на эту генерацию уже есть (повтор запроса): списание откатилось вместе с командой. */
export class DuplicateOrderError extends Error {
  constructor() {
    super("Заказ на эту генерацию уже есть");
    this.name = "DuplicateOrderError";
  }
}

/** Код и неосвобождённые использования его этим устройством и этим IP. */
export type PromoMatch = PromoRow & { usage: Usage };

export type OrderRepository = {
  /**
   * Код вместе со счётчиками человека — ОДНИМ запросом при любом исходе: «кода нет» и «код есть,
   * но не тебе» не различаются по числу обращений к БД (правило 6: причину не выдаём и временем).
   */
  findPromo(normalizedCode: string, person: Person): Promise<PromoMatch | null>;
  /** Пробы Поджога (не `voided`) этого устройства и этого IP. */
  trialUsage(person: Person): Promise<Usage>;
  /**
   * Атомарно: списать код + создать заказ `free` + записать использование — ОДНОЙ SQL-командой.
   * Вернёт `id` заказа. `null` — код не списан (исчерпан, выключен, вне окна, лимит на человека,
   * цена кода изменилась): не было ничего, откатывать нечего.
   */
  redeemAndCreateOrder(input: RedeemInput): Promise<string | null>;
  /** Заказ `free` с причиной `first_free`: вернёт `id`. `null` — проба уже использована. */
  createTrialOrder(input: TrialInput): Promise<string | null>;
  /** Освободить заказ. `true` — освободили сейчас; `false` — уже освобождён или не подлежит. */
  release(orderId: string, now: Date): Promise<boolean>;
  /** `id` заказа генерации (на `generationId` уникальный индекс) или `null`. */
  orderIdFor(generationId: string): Promise<string | null>;
};

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Строки результата `db.execute` (neon-http отдаёт `{ rows }`). */
async function rowsOf<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db().execute(query);
  return result.rows as T[];
}

/**
 * SQL списания кода. Одна команда = одна транзакция Postgres: `neon-http` интерактивных транзакций
 * не умеет, а `db.batch` не даёт передать результат одной команды в другую. Цепочка CTE:
 * `promo` (UPDATE счётчика с условиями) → `ord` (INSERT заказа из строки `promo`) → INSERT использования
 * из `promo` и `ord`. Если `promo` вернул 0 строк, остальное пусто. Если любой INSERT упал (дубль
 * `generation_id`, FK), откатывается вся команда вместе со счётчиком: он «утечь» не может.
 * Два параллельных заказа на последний код: второй UPDATE ждёт блокировку строки, перечитывает
 * `redeemed < max_redemptions` уже по новой версии и вернёт 0 строк.
 *
 * Лимиты на человека считаются подзапросом по снимку команды, поэтому два ОДНОВРЕМЕННЫХ заказа одного
 * устройства могут оба увидеть «0 использований» и пройти. Это осознанно: perDevice/perIp — защита от
 * случайного шаринга, а не от целенаправленного абуза (§9.3 п. 7); потолок кода (`max_redemptions`)
 * держится строго.
 */
export function redeemSql(input: RedeemInput) {
  const now = input.now.toISOString();
  return sql`
    WITH promo AS (
      UPDATE promo_codes SET redeemed = redeemed + 1
      WHERE code = ${input.promoCode}
        AND active
        AND redeemed < max_redemptions
        AND percent_off = ${input.percentOff}::int
        AND ${input.tier}::int = ANY(tiers)
        AND (valid_from IS NULL OR valid_from <= ${now}::timestamptz)
        AND (valid_until IS NULL OR valid_until > ${now}::timestamptz)
        AND (per_device_limit IS NULL OR (SELECT count(*) FROM promo_redemptions r WHERE r.promo_id = promo_codes.id AND r.released_at IS NULL AND r.owner_token_hash = ${input.ownerTokenHash}) < per_device_limit)
        AND (per_ip_limit IS NULL OR (SELECT count(*) FROM promo_redemptions r WHERE r.promo_id = promo_codes.id AND r.released_at IS NULL AND r.ip_hash = ${input.ipHash}) < per_ip_limit)
      RETURNING id
    ),
    ord AS (
      INSERT INTO orders (id, generation_id, tier, list_amount, discount_amount, final_amount, promo_id, status, reason, owner_token_hash, ip_hash, created_at, updated_at)
      SELECT ${randomUUID()}, ${input.generationId}, ${input.tier}::int, ${input.listAmount}::int, ${input.discountAmount}::int, ${input.finalAmount}::int, promo.id, 'free'::order_status, 'promo_free'::order_reason, ${input.ownerTokenHash}, ${input.ipHash}, ${now}::timestamptz, ${now}::timestamptz
      FROM promo
      RETURNING id
    )
    INSERT INTO promo_redemptions (id, promo_id, order_id, owner_token_hash, ip_hash, created_at)
    SELECT ${randomUUID()}, promo.id, ord.id, ${input.ownerTokenHash}, ${input.ipHash}, ${now}::timestamptz
    FROM promo, ord
    RETURNING order_id`;
}

/**
 * SQL пробы: INSERT … SELECT с потолком по IP и `ON CONFLICT DO NOTHING` по частичному уникальному
 * индексу устройства (`orders_first_free_owner_idx`): две одновременные пробы одного устройства —
 * проходит одна, вторая получает 0 строк.
 */
export function trialSql(input: TrialInput) {
  const now = input.now.toISOString();
  return sql`
    INSERT INTO orders (id, generation_id, tier, list_amount, discount_amount, final_amount, promo_id, status, reason, owner_token_hash, ip_hash, created_at, updated_at)
    SELECT ${randomUUID()}, ${input.generationId}, ${input.tier}::int, ${input.listAmount}::int, ${input.discountAmount}::int, ${input.finalAmount}::int, NULL::text, 'free'::order_status, 'first_free'::order_reason, ${input.ownerTokenHash}, ${input.ipHash}, ${now}::timestamptz, ${now}::timestamptz
    WHERE (SELECT count(*) FROM orders o WHERE o.ip_hash = ${input.ipHash} AND o.reason = 'first_free' AND o.status <> 'voided') < ${input.maxPerIp}::int
    ON CONFLICT (owner_token_hash) WHERE reason = 'first_free' AND status <> 'voided' DO NOTHING
    RETURNING id`;
}

/**
 * SQL освобождения. Идемпотентность: заказ переводится в `voided` только из `free`/`created`; цепочка
 * `ord` → `red` → `code` зависит от того, что строка реально поменялась в этой же команде, а
 * `released_at IS NULL` не даёт освободить использование дважды. Повторный вызов: `ord` пуст,
 * счётчик не трогается.
 */
export function releaseSql(orderId: string, now: Date) {
  const at = now.toISOString();
  return sql`
    WITH ord AS (
      UPDATE orders SET status = 'voided', updated_at = ${at}::timestamptz
      WHERE id = ${orderId} AND status IN ('free', 'created')
      RETURNING id
    ),
    red AS (
      UPDATE promo_redemptions SET released_at = ${at}::timestamptz
      WHERE order_id IN (SELECT id FROM ord) AND released_at IS NULL
      RETURNING promo_id
    ),
    code AS (
      UPDATE promo_codes SET redeemed = redeemed - 1
      WHERE id IN (SELECT promo_id FROM red) AND redeemed > 0
      RETURNING id
    )
    SELECT (SELECT count(*) FROM ord)::int AS voided`;
}

/** Запрос `findPromo`: код + неосвобождённые использования человека одной командой. */
export function findPromoQuery(
  database: Pick<ReturnType<typeof db>, "select">,
  normalizedCode: string,
  { ownerTokenHash, ipHash }: Person,
) {
  // Таблица указана явно: в выборке из одной таблицы drizzle пишет колонку без неё (`"id"`), и внутри
  // подзапроса это было бы `r.id`, а счётчик — всегда 0.
  const live = (match: ReturnType<typeof sql>) =>
    sql<number>`(SELECT count(*) FROM promo_redemptions r WHERE r.promo_id = promo_codes.id AND r.released_at IS NULL AND ${match})::int`;
  return database
    .select({
      id: schema.promoCodes.id,
      percentOff: schema.promoCodes.percentOff,
      tiers: schema.promoCodes.tiers,
      maxRedemptions: schema.promoCodes.maxRedemptions,
      redeemed: schema.promoCodes.redeemed,
      perDeviceLimit: schema.promoCodes.perDeviceLimit,
      perIpLimit: schema.promoCodes.perIpLimit,
      validFrom: schema.promoCodes.validFrom,
      validUntil: schema.promoCodes.validUntil,
      active: schema.promoCodes.active,
      device: live(sql`r.owner_token_hash = ${ownerTokenHash}::text`),
      ip: live(sql`r.ip_hash = ${ipHash}`),
    })
    .from(schema.promoCodes)
    .where(eq(schema.promoCodes.code, normalizedCode))
    .limit(1);
}

export function createOrderRepository(): OrderRepository {
  const countUsage = async (query: ReturnType<typeof sql>): Promise<Usage> => {
    const [row] = await rowsOf<{ device: number; ip: number }>(query);
    return { device: Number(row?.device ?? 0), ip: Number(row?.ip ?? 0) };
  };

  return {
    async findPromo(normalizedCode, person) {
      const [row] = await findPromoQuery(db(), normalizedCode, person);
      if (!row) return null;
      const { device, ip, ...promo } = row;
      return { ...promo, usage: { device: Number(device), ip: Number(ip) } };
    },

    trialUsage: ({ ownerTokenHash, ipHash }) =>
      countUsage(sql`
        SELECT
          (SELECT count(*) FROM orders WHERE reason = 'first_free' AND status <> 'voided' AND owner_token_hash = ${ownerTokenHash}::text)::int AS device,
          (SELECT count(*) FROM orders WHERE reason = 'first_free' AND status <> 'voided' AND ip_hash = ${ipHash})::int AS ip`),

    async redeemAndCreateOrder(input) {
      try {
        const [row] = await rowsOf<{ order_id: string }>(redeemSql(input));
        return row?.order_id ?? null;
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateOrderError();
        throw error;
      }
    },

    async createTrialOrder(input) {
      try {
        const [row] = await rowsOf<{ id: string }>(trialSql(input));
        return row?.id ?? null;
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateOrderError();
        throw error;
      }
    },

    async release(orderId, now) {
      const [row] = await rowsOf<{ voided: number }>(releaseSql(orderId, now));
      return Number(row?.voided ?? 0) > 0;
    },

    async orderIdFor(generationId) {
      const rows = await db()
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(eq(schema.orders.generationId, generationId))
        .limit(1);
      return rows[0]?.id ?? null;
    },
  };
}
