import { z } from "zod";
import { ArtifactKind, GenerationMode } from "./generation";

export const PredictionArea = z.enum(["love", "money", "travel", "career", "health", "wildcard"]);
export type PredictionArea = z.infer<typeof PredictionArea>;

export const ArtifactContent = z.object({
  /** «Досье на @username». */
  title: z.string().min(1),
  /** Одна строка-хук. */
  tagline: z.string().min(1),
  traits: z
    .array(
      z.object({ label: z.string().min(1), value: z.string().min(1), emoji: z.string().min(1) }),
    )
    .min(4)
    .max(6),
  superpower: z.string().min(1),
  weakness: z.string().min(1),
  predictions: z
    .array(z.object({ area: PredictionArea, text: z.string().min(1) }))
    .min(3)
    .max(6),
  closing: z.string().min(1),
});
export type ArtifactContent = z.infer<typeof ArtifactContent>;

export const ImageRole = z.enum(["hero", "section"]);
export type ImageRole = z.infer<typeof ImageRole>;

export const ArtifactImage = z.object({
  role: ImageRole,
  url: z.url(),
  alt: z.string().min(1),
});
export type ArtifactImage = z.infer<typeof ArtifactImage>;

/** Только BE. Выход шага `write`: текст + промпты для шага `draw`. */
export const ArtifactDraft = z.object({
  content: ArtifactContent,
  imagePrompts: z
    .array(z.object({ role: ImageRole, prompt: z.string().min(1), alt: z.string().min(1) }))
    .min(3)
    .max(5),
});
export type ArtifactDraft = z.infer<typeof ArtifactDraft>;

/** GET /api/artifacts/:slug и страница /a/[slug]. Публичные данные, без сырого профиля. */
export const Artifact = z.object({
  slug: z.string().length(10),
  kind: ArtifactKind,
  createdAt: z.iso.datetime(),
  subject: z.object({
    username: z.string().min(1),
    displayName: z.string().min(1),
    avatarUrl: z.url().nullable(),
  }),
  mode: GenerationMode,
  content: ArtifactContent,
  /** 0–5 картинок: при частичном сбое шага `draw` артефакт собирается без упавших. */
  images: z.array(ArtifactImage).max(5),
  /** Вычисляется по cookie `ownerToken`, у чужих — false. */
  isOwner: z.boolean(),
});
export type Artifact = z.infer<typeof Artifact>;
