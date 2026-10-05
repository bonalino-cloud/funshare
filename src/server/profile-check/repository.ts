import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, or } from "drizzle-orm";
import type { CheckedProfile, ErrorCode, ProfileCheckStatusCode } from "@/contracts";
import { db, schema } from "../db";

/** Строка проверки. `profile` НЕ доверенный (jsonb): вызывающий парсит `CheckedProfile`. */
export type ProfileCheckRow = {
  id: string;
  igUsername: string;
  status: ProfileCheckStatusCode;
  errorCode: ErrorCode | null;
  hint: string | null;
  snapshotId: string | null;
  profile: unknown;
  ownerTokenHash: string;
  checkedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewProfileCheck = {
  igUsername: string;
  ownerTokenHash: string;
  ipHash: string;
} & (
  | { status: "checking"; hint: string }
  /** Копия результата из кэша: `checkedAt` наследуется от источника. */
  | {
      status: "ok";
      snapshotId: string | null;
      profile: CheckedProfile;
      checkedAt: Date;
    }
  | { status: "failed"; errorCode: ErrorCode; checkedAt: Date }
);

export type ProfileCheckRepository = {
  insert(row: NewProfileCheck): Promise<string>;
  get(id: string): Promise<ProfileCheckRow | null>;
  /** Свежий результат по нику (ok или minor_detected), не старше `since` по `checkedAt`. */
  findCached(igUsername: string, since: Date): Promise<ProfileCheckRow | null>;
  /** Меняют только проверку в `checking`; вернёт `false`, если строка уже закрыта. */
  setHint(id: string, hint: string): Promise<boolean>;
  complete(
    id: string,
    result: { snapshotId: string; profile: CheckedProfile; checkedAt: Date },
  ): Promise<boolean>;
  fail(id: string, errorCode: ErrorCode, checkedAt: Date): Promise<boolean>;
};

const columns = {
  id: schema.profileChecks.id,
  igUsername: schema.profileChecks.igUsername,
  status: schema.profileChecks.status,
  errorCode: schema.profileChecks.errorCode,
  hint: schema.profileChecks.hint,
  snapshotId: schema.profileChecks.snapshotId,
  profile: schema.profileChecks.profile,
  ownerTokenHash: schema.profileChecks.ownerTokenHash,
  checkedAt: schema.profileChecks.checkedAt,
  createdAt: schema.profileChecks.createdAt,
  updatedAt: schema.profileChecks.updatedAt,
};

export function createProfileCheckRepository(): ProfileCheckRepository {
  const stillChecking = (id: string) =>
    and(eq(schema.profileChecks.id, id), eq(schema.profileChecks.status, "checking"));

  /** UPDATE ... WHERE status = 'checking' RETURNING: так видно, сработало ли обновление. */
  const updateChecking = async (
    id: string,
    set: Partial<typeof schema.profileChecks.$inferInsert>,
  ) => {
    const rows = await db()
      .update(schema.profileChecks)
      .set(set)
      .where(stillChecking(id))
      .returning({ id: schema.profileChecks.id });
    return rows.length > 0;
  };

  return {
    async insert(row) {
      const id = randomUUID();
      await db()
        .insert(schema.profileChecks)
        .values({
          id,
          igUsername: row.igUsername,
          ownerTokenHash: row.ownerTokenHash,
          ipHash: row.ipHash,
          status: row.status,
          hint: row.status === "checking" ? row.hint : null,
          errorCode: row.status === "failed" ? row.errorCode : null,
          snapshotId: row.status === "ok" ? row.snapshotId : null,
          profile: row.status === "ok" ? row.profile : null,
          checkedAt: row.status === "checking" ? null : row.checkedAt,
        });
      return id;
    },

    async get(id) {
      const rows = await db()
        .select(columns)
        .from(schema.profileChecks)
        .where(eq(schema.profileChecks.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findCached(igUsername, since) {
      const rows = await db()
        .select(columns)
        .from(schema.profileChecks)
        .where(
          and(
            eq(schema.profileChecks.igUsername, igUsername),
            gte(schema.profileChecks.checkedAt, since),
            or(
              eq(schema.profileChecks.status, "ok"),
              and(
                eq(schema.profileChecks.status, "failed"),
                eq(schema.profileChecks.errorCode, "minor_detected"),
              ),
            ),
          ),
        )
        .orderBy(desc(schema.profileChecks.checkedAt))
        .limit(1);
      return rows[0] ?? null;
    },

    setHint: (id, hint) => updateChecking(id, { hint }),

    complete: (id, { snapshotId, profile, checkedAt }) =>
      updateChecking(id, { status: "ok", hint: null, snapshotId, profile, checkedAt }),

    fail: (id, errorCode, checkedAt) =>
      updateChecking(id, { status: "failed", hint: null, errorCode, checkedAt }),
  };
}
