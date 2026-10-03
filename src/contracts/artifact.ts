import { z } from "zod";
import { ArtifactKind, GenerationMode, PUNCH_MAX_CHARS } from "./generation";

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

/** Шутка в готовом артефакте. `id` совпадает с id кандидата: по нему считаем «в точку / мимо». */
export const Punch = z.object({
  id: z.string().min(1),
  emoji: z.string().min(1),
  text: z.string().min(1).max(PUNCH_MAX_CHARS),
});
export type Punch = z.infer<typeof Punch>;

/** Текст прожарки. В артефакт попадают ровно выбранные шутки, в порядке выбора. */
export const RoastContent = z.object({
  /** «Прожарка @username». */
  title: z.string().min(1),
  /** Одна строка-хук. */
  tagline: z.string().min(1),
  punches: z.array(Punch).min(1).max(12),
  /** Тёплый финал. */
  finale: z.string().min(1),
  /** Текст для кнопок «поделиться» и OG-превью. */
  shareText: z.string().min(1).max(140),
});
export type RoastContent = z.infer<typeof RoastContent>;

/** Цвет `#rrggbb` в нижнем регистре. */
export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/);
export type HexColor = z.infer<typeof HexColor>;

/**
 * Картинка к шутке для карточки 9:16. Шаг `draw` рисует один холст 2×3 на все шутки,
 * режет его на квадраты и для каждого берёт цвет однотонного фона: карточка
 * заливается этим цветом, и квадрат сливается с ней без шва.
 */
export const PunchImage = z.object({
  /** id шутки из `content.punches`. */
  punchId: z.string().min(1),
  /** Квадрат, не меньше 1024×1024. */
  url: z.url(),
  alt: z.string().min(1),
  /** Цвет фона квадрата (медиана по его краю). */
  bg: HexColor,
});
export type PunchImage = z.infer<typeof PunchImage>;

/** Только BE. Выход шага `write`: текст + промпты для шага `draw`. */
export const ArtifactDraft = z.object({
  content: z.union([ArtifactContent, RoastContent]),
  imagePrompts: z
    .array(z.object({ role: ImageRole, prompt: z.string().min(1), alt: z.string().min(1) }))
    // Столько, сколько выбрано шуток, до 6; у Поджога ни одной
    .max(6),
});
export type ArtifactDraft = z.infer<typeof ArtifactDraft>;

/** GET /api/artifacts/:slug и страница /a/[slug]. Публичные данные, без сырого профиля. */
const ArtifactBase = z.object({
  slug: z.string().length(10),
  createdAt: z.iso.datetime(),
  subject: z.object({
    username: z.string().min(1),
    displayName: z.string().min(1),
    avatarUrl: z.url().nullable(),
  }),
  mode: GenerationMode,
  /** 0–5 картинок: при частичном сбое шага `draw` артефакт собирается без упавших. */
  images: z.array(ArtifactImage).max(5),
  /** Вычисляется по cookie `ownerToken`, у чужих — false. */
  isOwner: z.boolean(),
});

/** Форма `content` зависит от `kind`; новые типы артефактов добавляются сюда новой веткой. */
export const Artifact = z.discriminatedUnion("kind", [
  ArtifactBase.extend({
    kind: z.literal(ArtifactKind.enum.dossier_2027),
    content: ArtifactContent,
  }),
  ArtifactBase.extend({
    kind: z.literal(ArtifactKind.enum.roast_v1),
    content: RoastContent,
    /**
     * Картинки к шуткам, по одной на шутку. Поджог: пусто. Кострище и Пекло: по картинке
     * на каждую выбранную шутку, при частичном сбое `draw` упавших нет (карточка без картинки).
     */
    punchImages: z.array(PunchImage).max(6),
  }).superRefine((a, ctx) => {
    const ids = new Set(a.content.punches.map((p) => p.id));
    const seen = new Set<string>();
    for (const [i, img] of a.punchImages.entries()) {
      if (!ids.has(img.punchId) || seen.has(img.punchId)) {
        ctx.addIssue({
          code: "custom",
          path: ["punchImages", i, "punchId"],
          message: "картинка не к выбранной шутке или вторая к той же",
        });
      }
      seen.add(img.punchId);
    }
  }),
]);
export type Artifact = z.infer<typeof Artifact>;
