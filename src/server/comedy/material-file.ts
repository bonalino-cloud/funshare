import { z } from "zod";
import { sniffImageType } from "../analyze/cover-fetch";
import { BIO_CAP, CAPTION_CAP, capCodepoints, cleanUntrusted, sanitizeText } from "../facts/text";
import { MAX_IMAGE_BYTES_TOTAL, MAX_IMAGES } from "./config";
import { cleanExtraFacts, cleanLocation, cleanName, cleanTag, externalHost } from "./material";
import type { ComedyMaterial, ImageLabel, MaterialImage, MaterialPost } from "./types";

// Материал из JSON-файла (`pnpm comedy:try --material`, comedy-engine §2): формат `ComedyMaterial`
// без байтов, картинки путями. Файл — недоверенные данные (собран скрейпом из чужого профиля):
// схема до использования, затем та же чистка, что у снимка Apify (PII в подписях и био, адреса
// в локациях, путь ссылки из шапки).

const NAME_CAP = 100;
/** Постов из файла: сетка Agent Reach ~42 поста, с запасом. */
const MAX_FILE_POSTS = 48;
/** Потолок одной картинки из файла (как у обложек `analyze`). */
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
/** Факты кода из файла длиннее этого в промпт не идут: защита от раздутого входа. */
const FACTS_JSON_CAP = 20_000;

const Count = z.number().int().nonnegative().nullable().default(null);

export const MaterialFile = z.object({
  source: z.enum(["apify", "agent-reach"]).default("agent-reach"),
  username: z.string().min(1).max(100),
  displayName: z.string().max(300).default(""),
  biography: z.string().max(3000).default(""),
  counters: z
    .object({ posts: Count, followers: Count, following: Count })
    .default({ posts: null, followers: null, following: null }),
  externalUrl: z.string().max(2000).nullable().default(null),
  posts: z
    .array(
      z.object({
        index: z.number().int().min(0).max(9999),
        takenAt: z.string().max(40).nullable().default(null),
        type: z.string().max(20).nullable().default(null),
        caption: z.string().max(5000).default(""),
        hashtags: z.array(z.string().max(200)).max(60).default([]),
        location: z.string().max(300).nullable().default(null),
        likes: Count,
        comments: Count,
      }),
    )
    .max(100)
    .default([]),
  facts: z.record(z.string(), z.unknown()).nullable().default(null),
  images: z
    .array(
      z.object({
        label: z.union([z.literal("avatar"), z.string().regex(/^post:\d{1,4}$/)]),
        path: z.string().min(1).max(1000),
      }),
    )
    .max(MAX_IMAGES + 1)
    .default([]),
  extraFacts: z.array(z.string().max(500)).max(5).default([]),
});
export type MaterialFile = z.infer<typeof MaterialFile>;

/** Читает файл картинки; `null`, если нет. Путь уже разрешён вызывающим. */
export type LoadImageFn = (path: string) => Promise<Uint8Array | null>;
/** Уменьшение картинки (в скрипте — `resizeCover`, 512 px JPEG). */
export type ResizeFn = (data: Uint8Array) => Promise<{ data: Uint8Array; mediaType: string }>;

function cleanCaption(raw: string): string {
  const { text, hadPii } = cleanUntrusted(raw);
  // Подпись с PII целиком не идёт в LLM (как в `ProfileFacts.captionsForLlm`).
  return hadPii ? "" : capCodepoints(text, CAPTION_CAP);
}

function cleanPost(p: MaterialFile["posts"][number]): MaterialPost {
  return {
    index: p.index,
    takenAt: p.takenAt ? sanitizeText(p.takenAt) : null,
    type: p.type ? sanitizeText(p.type) : null,
    caption: cleanCaption(p.caption),
    hashtags: p.hashtags
      .map(cleanTag)
      .filter((t): t is string => t !== null)
      .slice(0, 10),
    location: cleanLocation(p.location),
    likes: p.likes,
    comments: p.comments,
  };
}

function cleanFacts(facts: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!facts) return null;
  return JSON.stringify(facts).length <= FACTS_JSON_CAP ? facts : null;
}

async function loadImages(
  images: MaterialFile["images"],
  loadImage: LoadImageFn,
  resize: ResizeFn | undefined,
): Promise<MaterialImage[]> {
  const out: MaterialImage[] = [];
  let total = 0;
  for (const img of images) {
    const raw = await loadImage(img.path);
    if (!raw || raw.byteLength === 0 || raw.byteLength > IMAGE_MAX_BYTES) continue;
    const sniffed = sniffImageType(raw);
    if (!sniffed) continue;
    const ready = resize
      ? await resize(raw).catch(() => ({ data: raw, mediaType: sniffed as string }))
      : { data: raw, mediaType: sniffed as string };
    if (total + ready.data.byteLength > MAX_IMAGE_BYTES_TOTAL) continue;
    total += ready.data.byteLength;
    out.push({ label: img.label as ImageLabel, data: ready.data, mediaType: ready.mediaType });
  }
  return out;
}

/** Файл материала → `ComedyMaterial`. Бросает `ZodError`, если файл не по схеме. */
export async function parseMaterialFile(
  raw: unknown,
  loadImage: LoadImageFn,
  options: { extraFacts?: readonly string[]; resize?: ResizeFn } = {},
): Promise<ComedyMaterial> {
  const file = MaterialFile.parse(raw);
  const bio = cleanUntrusted(file.biography);
  return {
    source: file.source,
    username: capCodepoints(sanitizeText(file.username), NAME_CAP),
    displayName: cleanName(file.displayName),
    biography: capCodepoints(bio.text, BIO_CAP),
    counters: file.counters,
    externalUrl: externalHost(file.externalUrl),
    posts: file.posts.slice(0, MAX_FILE_POSTS).map(cleanPost),
    facts: cleanFacts(file.facts),
    images: await loadImages(file.images, loadImage, options.resize),
    extraFacts: cleanExtraFacts([...file.extraFacts, ...(options.extraFacts ?? [])]),
  };
}
