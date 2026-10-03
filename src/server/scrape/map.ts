import { ProfilePost, ProfileSnapshot } from "@/contracts";
import { RawPost, type RawProfile } from "./raw-schema";

/** Сколько последних постов берём (architecture/roast-engine.md §2). */
export const MAX_POSTS = 24;

const MAX_CAPTION = 2200; // лимит самого Instagram; режем недоверенный текст
const MAX_BIO = 500;
const MAX_NAME = 200;
const MAX_HASHTAGS = 30;
const MAX_HASHTAG_LENGTH = 100;
const MAX_LOCATION = 200;

const POST_TYPES: Record<string, ProfilePost["type"]> = {
  image: "image",
  video: "video",
  sidecar: "carousel",
};

/**
 * Недоверенный текст → строка, которую примет jsonb. Postgres отвергает `\u0000` и одиночные
 * суррогаты, а `.slice()` по UTF-16 может разрезать эмодзи пополам — тогда падает весь insert.
 */
export function cleanText(value: string | null | undefined, max: number): string {
  const cut = (value ?? "").replaceAll("\u0000", "").slice(0, max);
  // Разрезанная на границе пара — отбрасываем хвост; прочие одиночные суррогаты — в U+FFFD.
  return cut
    .replace(/[\uD800-\uDBFF]$/, "")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) =>
      m.length === 2 ? m : "\uFFFD",
    );
}

/** Только http(s): `javascript:`, `data:` и мусор превращаются в null, а не в падение. */
function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function toCount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  // -1 у Apify означает «лайки скрыты».
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function toTimestamp(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  // Числа: секунды (Instagram) или миллисекунды.
  const date =
    typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractHashtags(raw: RawPost): string[] {
  const fromField = (raw.hashtags ?? []).filter((h): h is string => typeof h === "string");
  const source =
    fromField.length > 0
      ? fromField
      : Array.from((raw.caption ?? "").matchAll(/#([\p{L}\p{N}_]+)/gu), (m) => m[1] ?? "");
  const cleaned = source
    .map((h) => cleanText(h.replace(/^#+/, ""), MAX_HASHTAG_LENGTH + 1).trim())
    .filter((h) => h.length > 0 && h.length <= MAX_HASHTAG_LENGTH);
  return [...new Set(cleaned)].slice(0, MAX_HASHTAGS);
}

/** Один кривой пост → null (пропускаем), а не падение всего профиля. */
export function mapPost(item: unknown): ProfilePost | null {
  const parsed = RawPost.safeParse(item);
  if (!parsed.success) return null;
  const raw = parsed.data;
  const type = POST_TYPES[(raw.type ?? "").toLowerCase()];
  const takenAt = toTimestamp(raw.timestamp);
  if (!type || !takenAt) return null;
  return {
    type,
    caption: cleanText(raw.caption, MAX_CAPTION),
    hashtags: extractHashtags(raw),
    takenAt,
    likesCount: toCount(raw.likesCount),
    commentsCount: toCount(raw.commentsCount),
    imageUrl: safeUrl(raw.displayUrl),
    locationName: cleanText(raw.locationName, MAX_LOCATION).trim() || null,
  };
}

/**
 * Сырой профиль → `ProfileSnapshot`. Бросает ZodError, если после маппинга контракт не сходится
 * (вызывающий трактует это как «ответ не прошёл схему» и ретраит). `username` берём из запроса,
 * а не из ответа: он идёт в ключ кэша и Blob.
 */
export function mapProfile(raw: RawProfile, username: string, fetchedAt: Date): ProfileSnapshot {
  const posts = (raw.latestPosts ?? [])
    .map(mapPost)
    .filter((p): p is ProfilePost => p !== null)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
    .slice(0, MAX_POSTS);

  return ProfileSnapshot.parse({
    username,
    fullName: cleanText(raw.fullName, MAX_NAME),
    biography: cleanText(raw.biography, MAX_BIO),
    avatarUrl: safeUrl(raw.profilePicUrlHD) ?? safeUrl(raw.profilePicUrl),
    externalUrl: safeUrl(raw.externalUrl),
    isPrivate: raw.private === true,
    isVerified: raw.verified === true,
    followersCount: toCount(raw.followersCount) ?? 0,
    followsCount: toCount(raw.followsCount) ?? 0,
    postsCount: toCount(raw.postsCount) ?? 0,
    posts,
    fetchedAt: fetchedAt.toISOString(),
  });
}
