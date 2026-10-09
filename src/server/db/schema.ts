import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  Artifact,
  ArtifactContent,
  ArtifactImage,
  CheckedProfile,
  PersonaProfile,
  ProfileSnapshot,
  RoastContent,
} from "@/contracts";
import {
  ArtifactKind,
  ErrorCode,
  GenerationMode,
  GenerationStatusCode,
  Level,
  ProfileCheckStatusCode,
} from "@/contracts";
import { JOKE_HEATS, JOKE_MECHANISMS, JOKE_SLOTS, JOKE_TOPICS } from "../roast/jokes/card";
import type { CostRun } from "../cost/meter";
import type { PunchTrace } from "../roast/write/types";

// Enum-ы берём из контрактов, чтобы у поля был один набор значений везде.
const values = <T extends string>(options: readonly T[]) => options as [T, ...T[]];

export const generationStatus = pgEnum("generation_status", values(GenerationStatusCode.options));
export const errorCode = pgEnum("error_code", values(ErrorCode.options));
export const profileCheckStatus = pgEnum(
  "profile_check_status",
  values(ProfileCheckStatusCode.options),
);
export const generationMode = pgEnum("generation_mode", values(GenerationMode.options));
export const generationLevel = pgEnum("generation_level", values(Level.options));
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
    /**
     * Вход шага `write` из `GenerationRequest`. Колонки допускают null: строки, созданные до
     * `be/p1-generations-api`, этих данных не несут (генераций в БД тогда ещё не было).
     */
    profileCheckId: text("profile_check_id").references(() => profileChecks.id, {
      onDelete: "set null",
    }),
    tier: integer("tier"),
    level: generationLevel("level"),
    /** Факты от пользователя (до 5 по 140 знаков): недоверенный текст, идёт в промпт шага `write`. */
    extraFacts: jsonb("extra_facts")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Кострище: Поджог того же владельца и профиля, откуда берём выбранные шутки. Уже проверен. */
    trialGenerationId: text("trial_generation_id"),
    ownerTokenHash: text("owner_token_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    stepTimings: jsonb("step_timings").$type<StepTimings>().notNull().default({}),
    /** Итог трат на генерацию в центах: ceil от `costMicroUsd`. Стоимость проверки профиля сюда НЕ входит. */
    costCents: integer("cost_cents").notNull().default(0),
    /** Точная сумма трат шагов генерации, микро-USD (1e-6). Копится атомарным UPDATE. */
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    /** Разбивка по шагам: `{ [шаг]: CostRun[] }`, прогон на каждое выполнение шага (ретраи тоже). */
    costDetail: jsonb("cost_detail").$type<Record<string, CostRun[]>>().notNull().default({}),
    artifactId: text("artifact_id"),
    ...timestamps,
  },
  (t) => [
    index("generations_ip_hash_created_at_idx").on(t.ipHash, t.createdAt),
    index("generations_ig_username_idx").on(t.igUsername),
    check("generations_tier", sql`${t.tier} IS NULL OR ${t.tier} BETWEEN 1 AND 3`),
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

/**
 * Состояние досье по (снимок, версия промпта): замок «досье уже считается» и запись отказа.
 * `running` — кто-то считает (фон после «Нашли!» или старт генерации): второй платный вызов не
 * запускаем. Замок старше `DOSSIER_STALE_MS` считается брошенным (функцию убили) и перехватывается.
 * `refused` — гардрейл по досье (`minor_detected`, `not_enough_data`): старт генерации отказывает без
 * нового вызова модели. Готовое досье лежит в `personas`, строка здесь тогда удалена. Каскад
 * от снимка, как у `personas`.
 */
export const dossierRuns = pgTable(
  "dossier_runs",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => profileSnapshots.id, { onDelete: "cascade" }),
    promptVersion: text("prompt_version").notNull(),
    status: text("status").$type<"running" | "refused">().notNull(),
    errorCode: errorCode("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.promptVersion] }),
    check("dossier_runs_status", sql`${t.status} IN ('running', 'refused')`),
  ],
);

export type ArtifactSubject = Artifact["subject"];

export const artifacts = pgTable("artifacts", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  generationId: text("generation_id")
    .notNull()
    .unique()
    .references(() => generations.id),
  kind: artifactKind("kind").notNull(),
  content: jsonb("content").$type<ArtifactContent | RoastContent>().notNull(),
  images: jsonb("images")
    .$type<ArtifactImage[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Публичный `subject` на момент публикации; `null` у старых строк (тогда из generations + profile_checks). */
  subject: jsonb("subject").$type<ArtifactSubject>(),
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
    /** Траты самой проверки (Apify + анализ), центы вверх. Копия из кэша и `checking` — 0. */
    costCents: integer("cost_cents").notNull().default(0),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    /** Один `CostRun`; null, пока проверка не закрыта или это копия из кэша. */
    costDetail: jsonb("cost_detail").$type<CostRun>(),
    ...timestamps,
  },
  (t) => [index("profile_checks_ig_username_checked_at_idx").on(t.igUsername, t.checkedAt)],
);

/**
 * Заказ: цена посчитана сервером (клиенту не доверяем), сумма в целых копейках. Генерация стартует
 * только из заказа (roast-engine §9.3). Сейчас живут `free` (проба Поджога или код на 100 %) и
 * `voided` (генерация упала без артефакта); `created`/`paid`/`refunded` — с билингом (`be/p4-billing`).
 * Платный итог до билинга заказа не создаёт вовсе (402 `payment_required`): нечего хранить и нечего
 * списывать с кода.
 *
 * `generationId` без FK: заказ создаётся до строки генерации (или строка живёт по своим срокам, а
 * деньги учитываем дольше), порядок вставки не должен ломать списание. Уникален: один заказ на
 * генерацию, повтор запроса не удвоит списание кода.
 */
export const orderStatus = pgEnum("order_status", [
  "created",
  "free",
  "paid",
  "refunded",
  "voided",
]);
/** Почему заказ бесплатный. Правило 3: проба идёт тем же путём, что и всё остальное. */
export const orderReason = pgEnum("order_reason", ["first_free", "promo_free"]);

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: text("id").primaryKey(),
    /** Нормализованный (`normalizePromoCode`): регистр, пробелы, дефисы, кириллица-двойники. */
    code: text("code").notNull(),
    percentOff: integer("percent_off").notNull(),
    /** Для каких тарифов действует (1–3). */
    tiers: integer("tiers").array().notNull(),
    /** Обязателен у любого кода: безлимитных 100 % нет (правило 5). */
    maxRedemptions: integer("max_redemptions").notNull(),
    /** Счётчик списаний. Меняется только атомарно (`redeemed + 1 ... WHERE redeemed < max`). */
    redeemed: integer("redeemed").notNull().default(0),
    perDeviceLimit: integer("per_device_limit"),
    perIpLimit: integer("per_ip_limit"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("promo_codes_code_idx").on(t.code),
    check("promo_codes_code_not_empty", sql`length(${t.code}) > 0`),
    check("promo_codes_percent_off", sql`${t.percentOff} BETWEEN 1 AND 100`),
    check("promo_codes_max_redemptions", sql`${t.maxRedemptions} > 0`),
    check("promo_codes_redeemed", sql`${t.redeemed} >= 0`),
    check(
      "promo_codes_limits",
      sql`(${t.perDeviceLimit} IS NULL OR ${t.perDeviceLimit} > 0) AND (${t.perIpLimit} IS NULL OR ${t.perIpLimit} > 0)`,
    ),
    check("promo_codes_tiers", sql`cardinality(${t.tiers}) > 0 AND ${t.tiers} <@ ARRAY[1, 2, 3]`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id").notNull(),
    tier: integer("tier").notNull(),
    listAmount: integer("list_amount").notNull(),
    discountAmount: integer("discount_amount").notNull(),
    finalAmount: integer("final_amount").notNull(),
    promoId: text("promo_id").references(() => promoCodes.id),
    status: orderStatus("status").notNull(),
    reason: orderReason("reason"),
    /** Платёжный провайдер; пока билинга нет — всегда null. */
    provider: text("provider"),
    ownerTokenHash: text("owner_token_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_generation_id_idx").on(t.generationId),
    // Проба Поджога «один раз на человека»: гонку двух одновременных проб закрывает сама БД.
    // Упавшая генерация (`voided`) пробу возвращает.
    uniqueIndex("orders_first_free_owner_idx")
      .on(t.ownerTokenHash)
      .where(sql`${t.reason} = 'first_free' AND ${t.status} <> 'voided'`),
    index("orders_first_free_ip_idx")
      .on(t.ipHash)
      .where(sql`${t.reason} = 'first_free' AND ${t.status} <> 'voided'`),
    check("orders_tier", sql`${t.tier} BETWEEN 1 AND 3`),
    check(
      "orders_amounts",
      sql`${t.listAmount} >= 0 AND ${t.discountAmount} >= 0 AND ${t.discountAmount} <= ${t.listAmount} AND ${t.finalAmount} = ${t.listAmount} - ${t.discountAmount}`,
    ),
  ],
);

/** Использование кода. `releasedAt` — освобождено при провале генерации (правило 2). */
export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: text("id").primaryKey(),
    promoId: text("promo_id")
      .notNull()
      .references(() => promoCodes.id),
    orderId: text("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    ownerTokenHash: text("owner_token_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    index("promo_redemptions_promo_owner_idx").on(t.promoId, t.ownerTokenHash),
    index("promo_redemptions_promo_ip_idx").on(t.promoId, t.ipHash),
  ],
);

export const jokeMechanism = pgEnum("joke_mechanism", values(JOKE_MECHANISMS));
export const jokeSlot = pgEnum("joke_slot", values(JOKE_SLOTS));
export const jokeHeat = pgEnum("joke_heat", values(JOKE_HEATS));
export const jokeTopic = pgEnum("joke_topic", values(JOKE_TOPICS));

/**
 * Банк шуток (roast-engine.md §5.1). Корпус 18+ и разметка: читает только сервер, наружу не отдаётся.
 * `usableAsExample` не хранится: это функция от уровня (`roast/jokes/card.ts`, `conditions.ts`).
 *
 * `source` — «раздел + номер» из md (`s1#5`, у формул раздела 15 — порядковый), ключ upsert при
 * `jokes:ingest`. `textHash` — sha256 нормализованного текста + пометки 🔞: изменился хэш =
 * перезаписать разметку и сбросить `approved`. Карточки без разметки в таблицу не попадают.
 * Флаги `redline`/`wellDoneOnly` выводит код (`deriveFlags`), а не слово модели.
 */
export const jokeCards = pgTable(
  "joke_cards",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    section: integer("section").notNull(),
    /** Оригинал, только для внутреннего использования. */
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
    mechanism: jokeMechanism("mechanism").notNull(),
    skeleton: text("skeleton").notNull(),
    slots: jokeSlot("slots")
      .array()
      .notNull()
      .default(sql`'{}'::joke_slot[]`),
    heat: jokeHeat("heat").notNull(),
    topic: jokeTopic("topic").notNull(),
    redline: boolean("redline").notNull(),
    wellDoneOnly: boolean("well_done_only").notNull(),
    nsfw: boolean("nsfw").notNull(),
    transferable: boolean("transferable").notNull(),
    approved: boolean("approved").notNull().default(false),
    /** Обучаемый вес (§5.6), старт 0. */
    score: real("score").notNull().default(0),
    /** Версия промпта и модель разметки. */
    labelVersion: text("label_version").notNull(),
    labelModel: text("label_model").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("joke_cards_source_idx").on(t.source),
    index("joke_cards_text_hash_idx").on(t.textHash),
    // Страховка к `deriveFlags`: красные линии держит и БД, не только код.
    check("joke_cards_redline_topic", sql`${t.topic} NOT IN ('health', 'family') OR ${t.redline}`),
    check(
      "joke_cards_well_done_only_topic",
      sql`${t.topic} NOT IN ('body', 'sex') OR ${t.wellDoneOnly}`,
    ),
  ],
);

/**
 * Кандидаты шага `write` (roast-engine §5.5): до 10 шуток у Поджога, до 20 новых (и перенесённые
 * из Поджога) у Кострища. Строка = один `PunchCandidate` контракта плюс приватная трасса.
 *
 * `trace` (механика, оценки судьи, `jokeCardId` скелета) наружу не отдаётся никогда: ответ API
 * собирается из `punchId`, `emoji`, `text`, `fromTrial` и проходит `.parse()` (инвариант 20).
 * `selected` и `selectionPosition` (порядок в артефакте, с 1) ставит одна команда приёма выбора
 * (`be/p1-selection`); перенос в Кострище читает только выбранные.
 * Повтор шага не дублирует строки: уникален (`generationId`, `punchId`).
 */
export const punchCandidates = pgTable(
  "punch_candidates",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    /** `PunchCandidate.id` из контракта; у перенесённых сохраняется от Поджога. */
    punchId: text("punch_id").notNull(),
    /** Порядок в списке кандидатов (с нуля). */
    position: integer("position").notNull(),
    emoji: text("emoji").notNull(),
    text: text("text").notNull(),
    fromTrial: boolean("from_trial").notNull().default(false),
    selected: boolean("selected").notNull().default(false),
    /** Место шутки в выборе человека (с 1); у невыбранных `null`. */
    selectionPosition: integer("selection_position"),
    trace: jsonb("trace").$type<PunchTrace>().notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("punch_candidates_generation_punch_idx").on(t.generationId, t.punchId),
    check("punch_candidates_text_len", sql`char_length(${t.text}) BETWEEN 1 AND 140`),
    check(
      "punch_candidates_selection",
      sql`${t.selected} = (${t.selectionPosition} IS NOT NULL) AND (${t.selectionPosition} IS NULL OR ${t.selectionPosition} > 0)`,
    ),
  ],
);

/**
 * Приватные трассы шагов конвейера (roast-engine §8, §9.5): что писал писатель, кого вырезали
 * фильтры и судья, версии промптов и моделей. Читает только админка (BE); ни один публичный
 * роут эту таблицу не отдаёт и не джойнит. Срок хранения 30 дней (`data.md`), очистка Cron.
 * Одна строка на (`generationId`, `step`): повтор шага перезаписывает трассу, а не множит её.
 * `data` — JSON шага, форма зависит от `step` (для `write` это `WriteTrace`).
 */
export const generationTraces = pgTable(
  "generation_traces",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("generation_traces_generation_step_idx").on(t.generationId, t.step),
    // Для очистки по сроку хранения.
    index("generation_traces_created_idx").on(t.createdAt),
  ],
);
