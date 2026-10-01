/**
 * Разбор того, что человек вставил в поле: ссылка, @ник или ник.
 * Сервер делает свой разбор и отвечает `invalid_url`; здесь только подсказка до отправки.
 */

/** Латиница, цифры, `_` и `.`; без точки на краях, до 30 символов (правила Instagram) */
const USERNAME = /^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/i;

/** Хосты Instagram: основной, мобильный и короткий */
const INSTAGRAM_HOST = /^(?:(?:www|m)\.)?(?:instagram\.com|instagr\.am)$/i;

/** Первые сегменты пути, за которыми идёт не ник: пост, рилс, истории и т.п. */
const NOT_A_PROFILE = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "s",
]);

export type InputIssue =
  /** Поле пустое или ссылка набрана не до конца: подсказку не показываем */
  | "incomplete"
  /** Ссылка не на Instagram */
  | "not_instagram"
  /** Ссылка на Instagram, но не на профиль (пост, рилс, истории) */
  | "not_profile"
  /** Ник с лишними символами или длиннее 30 */
  | "bad_username";

export type InputCheck = { ok: true; username: string } | { ok: false; issue: InputIssue };

const fail = (issue: InputIssue): InputCheck => ({ ok: false, issue });

export function checkInstagramInput(raw: string): InputCheck {
  const s = raw.trim();
  if (!s) return fail("incomplete");

  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  const rest = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const [path = "", ...tail] = rest.split(/[?#]/)[0]?.split("/") ?? [];

  // «example.com/…» и «https://…» — это ссылка, у ссылки должен быть хост Instagram
  const isLink = hasProtocol || tail.length > 0 || INSTAGRAM_HOST.test(path);
  let name = path;
  if (isLink) {
    if (!INSTAGRAM_HOST.test(path)) return fail(path ? "not_instagram" : "incomplete");
    const [first = "", ...more] = tail;
    if (!first) return fail("incomplete"); // «instagram.com» или «instagram.com/»
    if (NOT_A_PROFILE.has(first.toLowerCase()) && more.length > 0) return fail("not_profile");
    name = first;
  }

  name = name.replace(/^@/, "");
  if (!name) return fail("incomplete");
  if (!USERNAME.test(name) || name.includes("..")) return fail("bad_username");
  return { ok: true, username: name.toLowerCase() };
}

/** Username или null, если это не похоже на профиль Instagram */
export function parseInstagramInput(raw: string): string | null {
  const r = checkInstagramInput(raw);
  return r.ok ? r.username : null;
}
