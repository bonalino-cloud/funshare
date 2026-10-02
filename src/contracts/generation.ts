import { z } from "zod";

export const ArtifactKind = z.enum(["dossier_2027"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const GenerationMode = z.enum(["self", "friend"]);
export type GenerationMode = z.infer<typeof GenerationMode>;

/** POST /api/generations — тело запроса. Разбор ссылки делает BE, при ошибке — errorCode `invalid_url`. */
export const GenerationRequest = z.object({
  instagramUrl: z.string().trim().min(1).max(300),
  mode: GenerationMode,
  kind: ArtifactKind,
});
export type GenerationRequest = z.infer<typeof GenerationRequest>;

/** POST /api/generations — ответ. */
export const GenerationCreated = z.object({
  id: z.string().min(1),
});
export type GenerationCreated = z.infer<typeof GenerationCreated>;

export const GenerationStatusCode = z.enum([
  "queued",
  "scraping",
  "analyzing",
  "writing",
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
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** GET /api/generations/:id — ответ. `errorCode` только при `failed`, `artifactSlug` только при `ready`. */
export const GenerationStatus = z
  .object({
    id: z.string().min(1),
    status: GenerationStatusCode,
    errorCode: ErrorCode.optional(),
    artifactSlug: z.string().min(1).optional(),
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
