import { z } from "zod";
import { Artifact } from "./artifact";
import { ErrorCode, GenerationMode, GenerationStatusCode, Level, Tier } from "./generation";
import { PersonaProfile } from "./persona";
import { Amount } from "./pricing";

/**
 * Админка (roast-engine §9.3–9.5). Контракт между BE (`src/app/api/admin/**`) и экранами
 * `src/app/admin/**`. Публичному сайту эти схемы не нужны.
 *
 * Правила: деньги — целые копейки (`Amount`, как в pricing.ts), себестоимость — целые микро-USD
 * (`costMicroUsd`, как в БД и `cost/meter.ts`), даты — ISO-строка. Хэшей IP и `ownerToken`
 * в схемах нет: на экране они не нужны. Лишние поля при `.parse()` отбрасываются.
 */

// ---------- общее ----------

/** Время в ISO, тем же способом, что и в остальных контрактах. */
const IsoDateTime = z.iso.datetime();

/** Целые микро-USD (1e-6 USD). */
const MicroUsd = z.number().int().nonnegative();

/** Непрозрачный курсор постраничной выдачи: клиент его не разбирает, только возвращает. */
const Cursor = z.string().min(1).max(200);

/** Постраничность: размер страницы с потолком. Параметры приходят строками из query. */
export const ADMIN_PAGE_MAX = 100;
export const ADMIN_PAGE_DEFAULT = 50;
const PageLimit = z.coerce.number().int().min(1).max(ADMIN_PAGE_MAX).default(ADMIN_PAGE_DEFAULT);

export const AdminPageQuery = z.object({
  cursor: Cursor.optional(),
  limit: PageLimit,
});
export type AdminPageQuery = z.infer<typeof AdminPageQuery>;

/** Тарифы как в БД: непустой набор без повторов. */
const TierList = z
  .array(Tier)
  .min(1)
  .refine((t) => new Set(t).size === t.length, { message: "тарифы без повторов" });

const Percent = z.number().int().min(1).max(100);
const PositiveInt = z.number().int().positive();
const PromoNote = z.string().trim().min(1).max(200);

/** Окно действия: если заданы оба края, начало строго раньше конца. */
const windowOk = (v: { validFrom?: string | null; validUntil?: string | null }) =>
  !v.validFrom || !v.validUntil || Date.parse(v.validFrom) < Date.parse(v.validUntil);
const WINDOW_ISSUE = { message: "validFrom должен быть раньше validUntil", path: ["validUntil"] };

// ---------- ошибки ----------

/**
 * Коды ошибок админки. Публичный `ErrorCode` не расширяем: он задаёт pgEnum `error_code` в БД,
 * а эти коды в БД не пишутся (только в ответах `/api/admin/**`).
 */
export const AdminErrorCode = z.enum([
  /** Нет сессии или токен неверный. */
  "unauthorized",
  /** Сессия есть, но аккаунта нет в белом списке. */
  "forbidden",
  "not_found",
  /** Тело или query не прошли схему. */
  "invalid_request",
  /** Конфликт состояния: код уже существует, генерация не в том статусе для перезапуска. */
  "conflict",
  /** Слишком много попыток входа. */
  "rate_limited",
  "internal",
]);
export type AdminErrorCode = z.infer<typeof AdminErrorCode>;

/**
 * Тело любой ошибки `/api/admin/**`. `message` — человеческими словами, без стека и SQL.
 * Поле не `errorCode`: под этим именем везде публичный `ErrorCode` (одно имя — один тип).
 */
export const AdminApiError = z.object({
  adminErrorCode: AdminErrorCode,
  message: z.string().min(1).max(300).optional(),
});
export type AdminApiError = z.infer<typeof AdminApiError>;

// ---------- вход ----------

/** POST /api/admin/login — быстрый вариант: секретный `ADMIN_TOKEN`. Ответ — `AdminSession`. */
export const AdminLoginRequest = z.object({
  token: z.string().min(1).max(500),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequest>;

/** GET /api/admin/session и ответ входа. `actor` идёт в `admin_audit.actor`. */
export const AdminSession = z.object({
  actor: z.string().min(1).max(100),
});
export type AdminSession = z.infer<typeof AdminSession>;

// ---------- промокоды (§9.3–9.4) ----------

/** Код в админке (нормализованный, как в БД). */
export const AdminPromoCode = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  percentOff: Percent,
  tiers: TierList,
  maxRedemptions: PositiveInt,
  /** Сколько раз списан (без освобождённых). */
  redeemed: z.number().int().nonnegative(),
  perDeviceLimit: PositiveInt.nullable(),
  perIpLimit: PositiveInt.nullable(),
  validFrom: IsoDateTime.nullable(),
  validUntil: IsoDateTime.nullable(),
  active: z.boolean(),
  note: z.string().nullable(),
  createdBy: z.string().min(1),
  createdAt: IsoDateTime,
});
export type AdminPromoCode = z.infer<typeof AdminPromoCode>;

/** Код в запросах: слово или случайный. Нормализацию (регистр, дефисы, двойники) делает BE. */
const PromoCodeInput = z.string().trim().min(3).max(40);

/**
 * POST /api/admin/promo-codes. Ответ — `AdminPromoCode`.
 * `code` не задан: сервер генерирует случайный вида `FUN-XXXX-XXXX`.
 * `maxRedemptions` обязателен всегда (правило 5: безлимитных кодов нет, 100 % тем более).
 * `perDeviceLimit` и `perIpLimit` не заданы: сервер ставит 2 и 4 (правило 7). `null` здесь
 * не принимаем: снять лимит можно только осознанной правкой (`AdminPromoUpdateRequest`).
 */
export const AdminPromoCreateRequest = z
  .object({
    code: PromoCodeInput.optional(),
    percentOff: Percent,
    tiers: TierList,
    maxRedemptions: PositiveInt,
    perDeviceLimit: PositiveInt.optional(),
    perIpLimit: PositiveInt.optional(),
    validFrom: IsoDateTime.optional(),
    validUntil: IsoDateTime.optional(),
    note: PromoNote.optional(),
  })
  .refine(windowOk, WINDOW_ISSUE);
export type AdminPromoCreateRequest = z.infer<typeof AdminPromoCreateRequest>;

/**
 * PATCH /api/admin/promo-codes/:id — частичная правка, хотя бы одно поле. Ответ — `AdminPromoCode`.
 * `null` снимает значение (лимит, срок, заметку). Процент и тарифы после создания не меняем:
 * заказы уже посчитаны по ним, для другой скидки заводят новый код.
 * Если в запросе только один край окна, BE сверяет его с краем из БД (здесь не видно).
 */
export const AdminPromoUpdateRequest = z
  .object({
    active: z.boolean(),
    note: PromoNote.nullable(),
    validFrom: IsoDateTime.nullable(),
    validUntil: IsoDateTime.nullable(),
    maxRedemptions: PositiveInt,
    perDeviceLimit: PositiveInt.nullable(),
    perIpLimit: PositiveInt.nullable(),
  })
  .partial()
  .refine((u) => Object.values(u).some((v) => v !== undefined), {
    message: "нужно передать хотя бы одно поле",
  })
  .refine(windowOk, WINDOW_ISSUE);
export type AdminPromoUpdateRequest = z.infer<typeof AdminPromoUpdateRequest>;

/** Потолок массового создания за один запрос. */
export const ADMIN_PROMO_BULK_MAX = 500;

/**
 * POST /api/admin/promo-codes/bulk — N разовых кодов вида `<PREFIX>-XXXX-XXXX`.
 * Каждый код получает `maxRedemptions = 1` и лимиты по умолчанию, поэтому этих полей здесь нет.
 */
export const AdminPromoBulkCreateRequest = z
  .object({
    count: z.number().int().min(1).max(ADMIN_PROMO_BULK_MAX),
    prefix: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{2,8}$/, { message: "префикс: 2–8 латинских букв и цифр" }),
    percentOff: Percent,
    tiers: TierList,
    validFrom: IsoDateTime.optional(),
    validUntil: IsoDateTime.optional(),
    note: PromoNote.optional(),
  })
  .refine(windowOk, WINDOW_ISSUE);
export type AdminPromoBulkCreateRequest = z.infer<typeof AdminPromoBulkCreateRequest>;

/** Ответ массового создания: все созданные коды (для скачивания списком). */
export const AdminPromoBulkCreateResponse = z.object({
  items: z.array(AdminPromoCode).min(1).max(ADMIN_PROMO_BULK_MAX),
});
export type AdminPromoBulkCreateResponse = z.infer<typeof AdminPromoBulkCreateResponse>;

/** GET /api/admin/promo-codes — query. */
export const AdminPromoListQuery = AdminPageQuery.extend({
  /** Только включённые или только выключенные. */
  active: z.stringbool().optional(),
  /** Подстрока кода или заметки. */
  search: z.string().trim().min(1).max(100).optional(),
});
export type AdminPromoListQuery = z.infer<typeof AdminPromoListQuery>;

/** GET /api/admin/promo-codes — ответ. `nextCursor: null` — страниц больше нет. */
export const AdminPromoList = z.object({
  items: z.array(AdminPromoCode),
  nextCursor: Cursor.nullable(),
});
export type AdminPromoList = z.infer<typeof AdminPromoList>;

/** Одно использование кода. Хэшей устройства и IP здесь нет. */
export const AdminPromoRedemption = z.object({
  id: z.string().min(1),
  createdAt: IsoDateTime,
  orderId: z.string().min(1),
  generationId: z.string().min(1).nullable(),
  /** Освобождено при провале генерации (правило 2). */
  releasedAt: IsoDateTime.nullable(),
});
export type AdminPromoRedemption = z.infer<typeof AdminPromoRedemption>;

/** GET /api/admin/promo-codes/:id/redemptions — ответ (query — `AdminPageQuery`). */
export const AdminPromoRedemptionList = z.object({
  items: z.array(AdminPromoRedemption),
  nextCursor: Cursor.nullable(),
});
export type AdminPromoRedemptionList = z.infer<typeof AdminPromoRedemptionList>;

// ---------- генерации (§9.5) ----------

export const AdminGenerationSort = z.enum(["created_desc", "cost_desc", "filtered_desc"]);
export type AdminGenerationSort = z.infer<typeof AdminGenerationSort>;

/** Дата без времени, `YYYY-MM-DD`; границы `from` и `to` включительно, сутки по UTC. */
const DateOnly = z.iso.date();

/** GET /api/admin/generations — query (всё строками, как приходит из URL). */
export const AdminGenerationListQuery = AdminPageQuery.extend({
  status: GenerationStatusCode.optional(),
  tier: z.coerce.number().pipe(Tier).optional(),
  mode: GenerationMode.optional(),
  errorCode: ErrorCode.optional(),
  /** Промокод; BE нормализует так же, как при вводе человеком. */
  promo: z.string().trim().min(1).max(40).optional(),
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  /** Ник профиля или `slug` артефакта. */
  search: z.string().trim().min(1).max(100).optional(),
  sort: AdminGenerationSort.default("created_desc"),
  /** Только генерации, где фильтры вырезали много или сработал слой 5. */
  needsReview: z.stringbool().optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, {
  message: "from не позже to",
  path: ["to"],
});
export type AdminGenerationListQuery = z.infer<typeof AdminGenerationListQuery>;

export const AdminOrderStatus = z.enum(["created", "free", "paid", "refunded", "voided"]);
export type AdminOrderStatus = z.infer<typeof AdminOrderStatus>;

export const AdminOrderReason = z.enum(["first_free", "promo_free"]);
export type AdminOrderReason = z.infer<typeof AdminOrderReason>;

/** Поля, общие для строки списка и карточки. */
const AdminGenerationBase = z.object({
  id: z.string().min(1),
  createdAt: IsoDateTime,
  /** У строк до `be/p1-generations-api` тарифа и степени нет. */
  tier: Tier.nullable(),
  mode: GenerationMode,
  level: Level.nullable(),
  igUsername: z.string().min(1),
  status: GenerationStatusCode,
  errorCode: ErrorCode.nullable(),
  artifactSlug: z.string().min(1).nullable(),
  /** Сумма заказа, копейки. `null` — заказа нет. */
  finalAmount: Amount.nullable(),
  promoCode: z.string().min(1).nullable(),
  /** От постановки в очередь до финального статуса; `null`, пока не закончилась. */
  durationMs: z.number().int().nonnegative().nullable(),
  costMicroUsd: MicroUsd,
  /** Сколько кандидатов вырезали фильтры, судья и модератор. */
  filteredCount: z.number().int().nonnegative(),
  /** Попадает в фильтр «нужна проверка». */
  needsReview: z.boolean(),
  /** Артефакт скрыт или удалён админом (публичная страница отдаёт 410). */
  hidden: z.boolean(),
  /** Помечена «плохой пример». */
  markedBad: z.boolean(),
});

export const AdminGenerationListItem = AdminGenerationBase;
export type AdminGenerationListItem = z.infer<typeof AdminGenerationListItem>;

/** GET /api/admin/generations — ответ. */
export const AdminGenerationList = z.object({
  items: z.array(AdminGenerationListItem),
  nextCursor: Cursor.nullable(),
});
export type AdminGenerationList = z.infer<typeof AdminGenerationList>;

/** Кто вырезал кандидата: детерминированные фильтры (слой 4), судья или модератор (слой 5). */
export const AdminRejectedBy = z.enum(["filter", "judge", "moderator"]);
export type AdminRejectedBy = z.infer<typeof AdminRejectedBy>;

/**
 * Кандидат в карточке: и выбранные, и вырезанные. Вырезанный текст может не влезать в 140 знаков
 * (его как раз вырезали за длину), поэтому потолок здесь мягче, чем у `PunchCandidate`.
 */
export const AdminPunch = z
  .object({
    punchId: z.string().min(1),
    emoji: z.string().min(1),
    text: z.string().min(1).max(2000),
    fromTrial: z.boolean(),
    selected: z.boolean(),
    /** Место в выборе человека (с 1); у невыбранных `null`. */
    selectionPosition: z.number().int().positive().nullable(),
    rejectedBy: AdminRejectedBy.nullable(),
    judgeScore: z.number().nullable(),
    /** Код причины вырезания (например, код фильтра). */
    reason: z.string().min(1).max(200).nullable(),
  })
  .refine((p) => p.selected === (p.selectionPosition !== null), {
    message: "selectionPosition задаётся тогда и только тогда, когда selected = true",
    path: ["selectionPosition"],
  });
export type AdminPunch = z.infer<typeof AdminPunch>;

/**
 * Трасса шага из `generation_traces`. Форма `data` принадлежит коду юмора и в контракт не
 * фиксируется: экран показывает её как дерево, не разбирая поля.
 */
export const AdminTrace = z.object({
  step: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTime,
});
export type AdminTrace = z.infer<typeof AdminTrace>;

/** Стоимость шага: сумма всех его прогонов (ретраи включены). */
export const AdminCostStep = z.object({
  step: z.string().min(1),
  runs: z.number().int().nonnegative(),
  costMicroUsd: MicroUsd,
});
export type AdminCostStep = z.infer<typeof AdminCostStep>;

export const AdminCost = z.object({
  costMicroUsd: MicroUsd,
  steps: z.array(AdminCostStep),
  /** Хоть одна цена не сверена или модель неизвестна. */
  estimated: z.boolean(),
});
export type AdminCost = z.infer<typeof AdminCost>;

export const AdminStepTiming = z.object({
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.optional(),
});
export type AdminStepTiming = z.infer<typeof AdminStepTiming>;

export const AdminOrder = z
  .object({
    tier: Tier,
    listAmount: Amount,
    discountAmount: Amount,
    finalAmount: Amount,
    status: AdminOrderStatus,
    reason: AdminOrderReason.nullable(),
    promoCode: z.string().min(1).nullable(),
  })
  .refine((o) => o.listAmount - o.discountAmount === o.finalAmount, {
    message: "finalAmount = listAmount − discountAmount",
    path: ["finalAmount"],
  });
export type AdminOrder = z.infer<typeof AdminOrder>;

/**
 * GET /api/admin/generations/:id — карточка. Каждый просмотр BE пишет в `admin_audit`.
 * Внутренние данные (трассы, оценки судьи): только админам, наружу не уходят (§8).
 */
export const AdminGenerationCard = AdminGenerationBase.extend({
  updatedAt: IsoDateTime,
  /** Готовый артефакт так, как его видит человек. */
  artifact: Artifact.nullable(),
  persona: PersonaProfile.nullable(),
  punches: z.array(AdminPunch),
  traces: z.array(AdminTrace),
  cost: AdminCost,
  stepTimings: z.record(z.string(), AdminStepTiming),
  /** `null` у строк без заказа. */
  order: AdminOrder.nullable(),
})
  .refine(
    (c) =>
      c.order === null
        ? c.finalAmount === null && c.promoCode === null
        : c.finalAmount === c.order.finalAmount && c.promoCode === c.order.promoCode,
    { message: "finalAmount и promoCode совпадают с order", path: ["order"] },
  )
  .refine((c) => c.cost.costMicroUsd === c.costMicroUsd, {
    message: "cost.costMicroUsd совпадает с costMicroUsd",
    path: ["cost", "costMicroUsd"],
  });
export type AdminGenerationCard = z.infer<typeof AdminGenerationCard>;

/**
 * POST /api/admin/generations/:id/actions. Каждое действие пишется в `admin_audit`.
 * `rerun` тратит деньги, поэтому требует `confirm: true` буквально.
 */
export const AdminGenerationAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("hide") }),
  z.object({ action: z.literal("delete") }),
  z.object({ action: z.literal("mark_bad"), note: PromoNote.optional() }),
  z.object({ action: z.literal("rerun"), confirm: z.literal(true) }),
]);
export type AdminGenerationAction = z.infer<typeof AdminGenerationAction>;

// ---------- аудит ----------

/**
 * Запись журнала. `action` — свободный код вида `promo.create`, `generation.view`;
 * `payload` BE наполняет без хэшей, токенов и текста чужого профиля.
 */
export const AdminAuditEntry = z.object({
  id: z.string().min(1),
  actor: z.string().min(1),
  action: z.string().min(1).max(100),
  target: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTime,
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

/** GET /api/admin/audit — query. Журнал быстро растёт за счёт `generation.view`, поэтому фильтры. */
export const AdminAuditListQuery = AdminPageQuery.extend({
  /** Точный код действия или префикс до точки: `promo` найдёт `promo.create`, `promo.update`. */
  action: z.string().trim().min(1).max(100).optional(),
  /** id промокода или генерации. */
  target: z.string().trim().min(1).max(200).optional(),
});
export type AdminAuditListQuery = z.infer<typeof AdminAuditListQuery>;

/** GET /api/admin/audit — ответ. */
export const AdminAuditList = z.object({
  items: z.array(AdminAuditEntry),
  nextCursor: Cursor.nullable(),
});
export type AdminAuditList = z.infer<typeof AdminAuditList>;
