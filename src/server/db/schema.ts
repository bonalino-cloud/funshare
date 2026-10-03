import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  ArtifactContent,
  ArtifactImage,
  CheckedProfile,
  PersonaProfile,
  ProfileSnapshot,
} from "@/contracts";
import {
  ArtifactKind,
  ErrorCode,
  GenerationMode,
  GenerationStatusCode,
  ProfileCheckStatusCode,
} from "@/contracts";

// Enum-ы берём из контрактов, чтобы у поля был один набор значений везде.
const values = <T extends string>(options: readonly T[]) => options as [T, ...T[]];

export const generationStatus = pgEnum("generation_status", values(GenerationStatusCode.options));
export const errorCode = pgEnum("error_code", values(ErrorCode.options));
export const profileCheckStatus = pgEnum(
  "profile_check_status",
  values(ProfileCheckStatusCode.options),
);
export const generationMode = pgEnum("generation_mode", values(GenerationMode.options));
export const artifactKind = pgEnum("artifact_kind", values(ArtifactKind.options));

/** Время начала/конца каждого шага конвейера, ISO-строки. */
export type StepTimings = Partial<Record<string, { startedAt: string; finishedAt?: string }>>;

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const generations = pgTable(
  "generations",
  {
    id: text("id").primaryKey(),
    status: generationStatus("status").notNull().default("queued"),
    errorCode: errorCode("error_code"),
    igUsername: text("ig_username").notNull(),
    mode: generationMode("mode").notNull(),
    kind: artifactKind("kind").notNull(),
    ownerTokenHash: text("owner_token_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    stepTimings: jsonb("step_timings").$type<StepTimings>().notNull().default({}),
    costCents: integer("cost_cents").notNull().default(0),
    artifactId: text("artifact_id"),
    ...timestamps,
  },
  (t) => [
    index("generations_ip_hash_created_at_idx").on(t.ipHash, t.createdAt),
    index("generations_ig_username_idx").on(t.igUsername),
  ],
);

/**
 * Кэш скрейпа на 24 ч. `data` — `ProfileSnapshot` (при чтении всё равно проходит `.parse()`),
 * `rawBlobKey` — ключ сырого ответа Apify в private Blob. Старше 30 дней удаляет Cron.
 */
export const profileSnapshots = pgTable(
  "profile_snapshots",
  {
    id: text("id").primaryKey(),
    igUsername: text("ig_username").notNull(),
    data: jsonb("data").$type<ProfileSnapshot>().notNull(),
    rawBlobKey: text("raw_blob_key").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("profile_snapshots_ig_username_fetched_at_idx").on(t.igUsername, t.fetchedAt)],
);

/**
 * Досье — источник истины для артефактов (инвариант 10). `data` — `PersonaProfile` (при чтении
 * всё равно проходит `.parse()`). Одно досье на (снимок, версия промпта): повтор шага обновляет
 * строку, а не плодит дубли. Каскад: досье производно от снимка и живёт не дольше него
 * (Cron удаляет снимки старше 30 дней, инвариант 5).
 */
export const personas = pgTable(
  "personas",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => profileSnapshots.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<PersonaProfile>().notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("personas_snapshot_id_prompt_version_idx").on(t.snapshotId, t.promptVersion)],
);

export const artifacts = pgTable("artifacts", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  generationId: text("generation_id")
    .notNull()
    .unique()
    .references(() => generations.id),
  kind: artifactKind("kind").notNull(),
  content: jsonb("content").$type<ArtifactContent>().notNull(),
  images: jsonb("images")
    .$type<ArtifactImage[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  ownerTokenHash: text("owner_token_hash").notNull(),
  views: integer("views").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * Проверка профиля до оплаты (шаг 1 флоу). Одна строка на каждый POST: у каждого человека свой `id`
 * и своя привязка к `ownerTokenHash`, даже если результат взят из кэша. `profile` — только то, что
 * показываем на экране «Нашли!» (без сырых данных профиля, инвариант 20).
 *
 * Кэш 24 ч считается по `checkedAt` — моменту, когда результат реально посчитан: копия из кэша
 * наследует `checkedAt` источника, иначе кэш продлевал бы сам себя. В кэш идут `ok` и отказ
 * `minor_detected` (остальные отказы дёшевы: снимок уже в кэше скрейпа). Хэши IP и ownerToken — инвариант 6.
 */
export const profileChecks = pgTable(
  "profile_checks",
  {
    id: text("id").primaryKey(),
    igUsername: text("ig_username").notNull(),
    status: profileCheckStatus("status").notNull().default("checking"),
    errorCode: errorCode("error_code"),
    /** Строка мини-лоудера, человеческими словами. */
    hint: text("hint"),
    /** Снимок, на котором считался результат: по нему генерация берёт досье. Снимки чистит Cron. */
    snapshotId: text("snapshot_id").references(() => profileSnapshots.id, {
      onDelete: "set null",
    }),
    profile: jsonb("profile").$type<CheckedProfile>(),
    ownerTokenHash: text("owner_token_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("profile_checks_ig_username_checked_at_idx").on(t.igUsername, t.checkedAt)],
);
