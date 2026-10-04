import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type {
  ArtifactKind,
  ErrorCode,
  GenerationMode,
  GenerationStatusCode,
  Level,
  Tier,
} from "@/contracts";
import { db, schema } from "../db";

/** Строка генерации для проверок владения и ответа GET. Хэши наружу не уходят. */
export type GenerationRow = {
  id: string;
  status: GenerationStatusCode;
  errorCode: ErrorCode | null;
  igUsername: string;
  /** `null` у строк, созданных до `be/p1-generations-api`. */
  tier: number | null;
  ownerTokenHash: string;
  /** Slug артефакта этой генерации (если он уже собран). */
  artifactSlug: string | null;
  updatedAt: Date;
};

/** Всё, что шагу `write` понадобится из запроса. Уже проверено и очищено вызывающим. */
export type NewGeneration = {
  id: string;
  igUsername: string;
  mode: GenerationMode;
  kind: ArtifactKind;
  profileCheckId: string;
  tier: Tier;
  level: Level;
  extraFacts: string[];
  /** Только прошедший проверку (тот же владелец и профиль, готовый Поджог) или `null`. */
  trialGenerationId: string | null;
  ownerTokenHash: string;
  ipHash: string;
};

export type GenerationRepository = {
  /** Строка со статусом `queued`. */
  insert(row: NewGeneration): Promise<void>;
  get(id: string): Promise<GenerationRow | null>;
  /** `failed` + код, пока артефакта нет (`ready` не трогаем). `true` — перевели сейчас. */
  markFailed(id: string, errorCode: ErrorCode, now: Date): Promise<boolean>;
};

export function createGenerationRepository(): GenerationRepository {
  return {
    async insert(row) {
      await db()
        .insert(schema.generations)
        .values({ ...row, status: "queued" });
    },

    async get(id) {
      const rows = await db()
        .select({
          id: schema.generations.id,
          status: schema.generations.status,
          errorCode: schema.generations.errorCode,
          igUsername: schema.generations.igUsername,
          tier: schema.generations.tier,
          ownerTokenHash: schema.generations.ownerTokenHash,
          artifactSlug: schema.artifacts.slug,
          updatedAt: schema.generations.updatedAt,
        })
        .from(schema.generations)
        .leftJoin(schema.artifacts, eq(schema.artifacts.generationId, schema.generations.id))
        .where(eq(schema.generations.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async markFailed(id, errorCode, now) {
      const rows = await db()
        .update(schema.generations)
        .set({ status: "failed", errorCode, updatedAt: now })
        .where(and(eq(schema.generations.id, id), ne(schema.generations.status, "ready")))
        .returning({ id: schema.generations.id });
      return rows.length > 0;
    },
  };
}

/** Идентификатор генерации: тот же способ, что у `profile_checks` (UUID v4). */
export const newGenerationId = () => randomUUID();
