import { z } from "zod";

export const ArtifactKind = z.enum(["dossier_2027", "roast_v1"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const GenerationMode = z.enum(["self", "friend"]);
export type GenerationMode = z.infer<typeof GenerationMode>;

/** Тариф: 1 — Поджог, 2 — Кострище, 3 — Пекло. Названия и тексты живут у FE, состав — в конфиге BE. */
export const Tier = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Tier = z.infer<typeof Tier>;

/** Степень прожарки. Не зависит от тарифа. `well_done` — 18+ и мат, требует `ageConfirmed`. */
export const Level = z.enum(["rare", "medium", "well_done"]);
export type Level = z.infer<typeof Level>;

/** Факт от пользователя про героя прожарки: до 5 штук по 140 знаков. */
export const ExtraFact = z.string().trim().min(1).max(140);

/**
 * POST /api/generations — тело запроса.
 * Профиль уже проверен (`profileCheckId` из ProfileCheckStatus со статусом `ok`), цена посчитана на сервере.
 */
export const GenerationRequest = z
  .object({
    profileCheckId: z.string().min(1),
    mode: GenerationMode,
    kind: ArtifactKind,
    tier: Tier,
    level: Level,
    /** Обязателен и равен true при `level = well_done`. */
    ageConfirmed: z.boolean().optional(),
    extraFacts: z.array(ExtraFact).max(5).optional(),
    /** «Волшебное слово». Нормализацию и проверку делает BE, ошибка — `promo_invalid`. */
    promoCode: z.string().trim().min(1).max(40).optional(),
    /**
     * Кострище: завершённая генерация Поджога того же владельца и профиля, откуда подтянуть
     * выбранные шутки (roast-engine §1). Чужую, незавершённую или другого профиля BE молча
     * игнорирует.
     */
    trialGenerationId: z.string().min(1).optional(),
  })
  .refine((r) => r.level !== "well_done" || r.ageConfirmed === true, {
    message: "well_done требует ageConfirmed = true",
    path: ["ageConfirmed"],
  });
export type GenerationRequest = z.infer<typeof GenerationRequest>;

/** POST /api/generations — ответ. */
export const GenerationCreated = z.object({
  id: z.string().min(1),
});
export type GenerationCreated = z.infer<typeof GenerationCreated>;

/**
 * Статусы генерации. Скрейп и анализ идут раньше, в проверке профиля (см. profile-check.ts),
 * поэтому генерация начинается сразу с текста. `awaiting_selection` — пауза: человек выбирает шутки.
 */
export const GenerationStatusCode = z.enum([
  "queued",
  "writing",
  "awaiting_selection",
  "drawing",
  "ready",
  "failed",
]);
export type GenerationStatusCode = z.infer<typeof GenerationStatusCode>;

export const ErrorCode = z.enum([
  "invalid_url",
  "profile_not_found",
  "profile_private",
  "not_enough_data",
  "minor_detected",
  "rate_limited",
  /** Бесплатная проба Поджога на этом устройстве уже была. */
  "free_used",
  /** Слово не подошло: нет, просрочено, исчерпано или лимит на человека. Причину не раскрываем. */
  "promo_invalid",
  /** Итог больше нуля, а оплата ещё не подключена. */
  "payment_required",
  /** Тело запроса не прошло схему или не JSON: ошибка формы запроса, а не человека. */
  "invalid_request",
  /** Запрошенный тариф сейчас недоступен (например, Пекло-заглушка). */
  "tier_unavailable",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * GET /api/generations/:id — ответ.
 * `errorCode` только при `failed`, `artifactSlug` только при `ready`.
 * `hint` — необязательная живая деталь для строки лоудера («47 закатов»), человеческими словами.
 */
export const GenerationStatus = z
  .object({
    id: z.string().min(1),
    status: GenerationStatusCode,
    errorCode: ErrorCode.optional(),
    artifactSlug: z.string().min(1).optional(),
    hint: z.string().min(1).max(80).optional(),
    updatedAt: z.iso.datetime(),
  })
  .refine((s) => (s.status === "failed") === (s.errorCode !== undefined), {
    message: "errorCode задаётся тогда и только тогда, когда status = failed",
    path: ["errorCode"],
  })
  .refine((s) => (s.status === "ready") === (s.artifactSlug !== undefined), {
    message: "artifactSlug задаётся тогда и только тогда, когда status = ready",
    path: ["artifactSlug"],
  });
export type GenerationStatus = z.infer<typeof GenerationStatus>;

/** Одна шутка-кандидат. Внутренние оценки и механики наружу не отдаются. */
/** Шутка влезает в карточку 9:16 только до 140 знаков: длиннее писатель не отдаёт. */
export const PUNCH_MAX_CHARS = 140;

export const PunchCandidate = z.object({
  id: z.string().min(1),
  emoji: z.string().min(1),
  text: z.string().min(1).max(PUNCH_MAX_CHARS),
  /** Перенесена из Поджога в Кострище («из пробы»), `id` сохранён. */
  fromTrial: z.boolean().optional(),
});
export type PunchCandidate = z.infer<typeof PunchCandidate>;

/** GET /api/generations/:id/candidates — доступен при `awaiting_selection`, только владельцу. */
export const CandidatesResponse = z
  .object({
    generationId: z.string().min(1),
    /** Сколько можно выбрать максимум: от 1 до `selectCount`. */
    selectCount: z.number().int().positive(),
    /** До N кандидатов: качественных шуток бывает меньше максимума (и меньше `selectCount`). */
    candidates: z.array(PunchCandidate).min(1),
  })
  .refine((c) => new Set(c.candidates.map((p) => p.id)).size === c.candidates.length, {
    message: "id кандидатов уникальны",
    path: ["candidates"],
  });
export type CandidatesResponse = z.infer<typeof CandidatesResponse>;

/**
 * POST /api/generations/:id/selection — выбор пользователя. Порядок = порядок в артефакте.
 * Сервер проверяет, что все id из кандидатов этой генерации и их от 1 до `selectCount`; ответ 202.
 */
export const SelectionRequest = z
  .object({
    punchIds: z.array(z.string().min(1)).min(1).max(20),
  })
  .refine((s) => new Set(s.punchIds).size === s.punchIds.length, {
    message: "punchIds без повторов",
    path: ["punchIds"],
  });
export type SelectionRequest = z.infer<typeof SelectionRequest>;
