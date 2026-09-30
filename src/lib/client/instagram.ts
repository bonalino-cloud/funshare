/**
 * Разбор того, что человек вставил в поле: ссылка, @ник или ник.
 * Возвращает username или null, если это не похоже на профиль Instagram.
 * Сервер делает свой разбор и отвечает `invalid_url`; здесь только подсказка до отправки.
 */
const USERNAME = /^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/i;

export function parseInstagramInput(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (/^instagram\.com\//i.test(s)) {
    s = s.replace(/^instagram\.com\//i, "");
  } else if (/^instagram\.com$/i.test(s)) {
    return null;
  }
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/^@/, "");
  return USERNAME.test(s) ? s.toLowerCase() : null;
}
