import { z } from "zod";
import { ErrorCode } from "./generation";

/**
 * Проверка профиля — шаг 1 флоу, до оплаты. Внутри скрейп и анализ с гардрейлами:
 * профиль открыт, постов хватает, владельцу есть 16. Результат кэшируется на 24 ч.
 */

/** POST /api/profile-checks — тело. Принимаем ссылку, @ник и ник; разбор делает BE. */
export const ProfileCheckRequest = z.object({
  instagramUrl: z.string().trim().min(1).max(300),
});
export type ProfileCheckRequest = z.infer<typeof ProfileCheckRequest>;

/** POST /api/profile-checks — ответ. */
export const ProfileCheckCreated = z.object({
  id: z.string().min(1),
});
export type ProfileCheckCreated = z.infer<typeof ProfileCheckCreated>;

export const ProfileCheckStatusCode = z.enum(["checking", "ok", "failed"]);
export type ProfileCheckStatusCode = z.infer<typeof ProfileCheckStatusCode>;

/** Что показываем на экране «Нашли!». Без сырых данных профиля. */
export const CheckedProfile = z.object({
  username: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.url().nullable(),
  postsCount: z.number().int().nonnegative(),
});
export type CheckedProfile = z.infer<typeof CheckedProfile>;

/**
 * GET /api/profile-checks/:id — ответ (поллинг раз в 2 с).
 * `profile` только при `ok`, `errorCode` только при `failed`, `hint` — строка для мини-лоудера.
 */
export const ProfileCheckStatus = z
  .object({
    id: z.string().min(1),
    status: ProfileCheckStatusCode,
    profile: CheckedProfile.optional(),
    errorCode: ErrorCode.optional(),
    hint: z.string().min(1).max(80).optional(),
    updatedAt: z.iso.datetime(),
  })
  .refine((s) => (s.status === "ok") === (s.profile !== undefined), {
    message: "profile задаётся тогда и только тогда, когда status = ok",
    path: ["profile"],
  })
  .refine((s) => (s.status === "failed") === (s.errorCode !== undefined), {
    message: "errorCode задаётся тогда и только тогда, когда status = failed",
    path: ["errorCode"],
  });
export type ProfileCheckStatus = z.infer<typeof ProfileCheckStatus>;
