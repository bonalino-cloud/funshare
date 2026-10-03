import type { ProfileSnapshot } from "@/contracts";

/** Сколько обложек уходит vision-модели (roast-engine.md §3). */
export const MAX_COVERS = 6;
const LIKED_FIRST = 3;
const MAX_URL_LENGTH = 2000;

export type Cover = { index: number; url: string };

/**
 * Только http(s), без логина и пароля в URL. Снимок читается из БД и парсится `z.url()`, а он
 * пропускает любые схемы (`javascript:`, `data:`, `file:`): повторяем проверку скрейпа здесь,
 * потому что URL уходит наружу, в запрос к модели.
 */
export function httpUrl(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username !== "" || url.password !== "") return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * До 6 обложек: сначала самые залайканные (до 3), затем самые свежие, остаток добираем
 * залайканными. Без дублей по посту и по URL. `index` = индекс поста в `snapshot.posts`.
 */
export function pickCovers(snapshot: ProfileSnapshot, limit = MAX_COVERS): Cover[] {
  const candidates = snapshot.posts.flatMap((post, index) => {
    const url = httpUrl(post.imageUrl);
    return url ? [{ index, url, likes: post.likesCount, time: Date.parse(post.takenAt) }] : [];
  });
  const liked = candidates
    .filter((c) => c.likes !== null)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0) || b.time - a.time || a.index - b.index);
  const fresh = [...candidates].sort((a, b) => b.time - a.time || a.index - b.index);

  const picked: Cover[] = [];
  const seenUrls = new Set<string>();
  const add = (c: { index: number; url: string }) => {
    if (picked.length >= limit || seenUrls.has(c.url)) return;
    seenUrls.add(c.url);
    picked.push({ index: c.index, url: c.url });
  };
  liked.slice(0, LIKED_FIRST).forEach(add);
  fresh.forEach(add);
  liked.forEach(add);
  return picked;
}
