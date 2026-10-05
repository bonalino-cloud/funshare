import { normalizeUsername } from "../scrape";

/** Первые сегменты путей Instagram, которые не профили: пост, рилс, сторис и т.п. */
const NOT_A_PROFILE = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "about",
  "legal",
  "developer",
  "web",
  "challenge",
  "oauth",
  "ar",
  "s",
]);

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

/**
 * Ссылка, @ник или ник → ник в нижнем регистре, либо `null` (мусор → `invalid_url`).
 * Ссылкой считаем только то, что начинается с http(s):// или с `instagram.com`; хост сверяем по
 * разобранному URL, а не по подстроке, чтобы `instagram.com@evil.com` и `evil.com/instagram.com/x`
 * не прошли. Всё остальное идёт в `normalizeUsername` как есть.
 */
export function parseInstagramInput(input: string): string | null {
  const value = input.trim();
  const looksLikeUrl = /^(https?:\/\/|(www\.|m\.)?instagram\.com(\/|$|\?|#))/i.test(value);
  if (!looksLikeUrl) return normalizeUsername(value);

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "" || url.port !== "") return null;
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segment = url.pathname.split("/").find((s) => s !== "");
  if (segment === undefined) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (NOT_A_PROFILE.has(decoded.toLowerCase())) return null;
  return normalizeUsername(decoded);
}
