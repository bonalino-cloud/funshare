// Нормализация текста для детерминированных проверок слоя 4 (roast-engine §6): регистр, ё/е,
// знаки препинания, простые обходы (латинские двойники букв, звёздочка внутри слова).

/** Латиница, похожая на кириллицу: подменяем только внутри слов, где уже есть кириллица. */
const HOMOGLYPHS: Record<string, string> = {
  a: "а",
  b: "в",
  c: "с",
  e: "е",
  h: "н",
  k: "к",
  m: "м",
  o: "о",
  p: "р",
  t: "т",
  x: "х",
  y: "у",
};

function unmixScripts(token: string): string {
  if (!/\p{Script=Cyrillic}/u.test(token) || !/[a-z]/.test(token)) return token;
  return token.replace(/[a-z]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
}

/**
 * Слова в нижнем регистре, «ё» → «е». Дефис разделяет слова («по-настоящему» → «по», «настоящему»),
 * звёздочка между буквами склеивает («х*й» → «хй»), знаки и цифры-разделители отбрасываются.
 */
export function normalizedWords(text: string): string[] {
  const lowered = text.toLowerCase().replace(/ё/g, "е");
  const unstarred = lowered.replace(/(?<=\p{L})\*+(?=\p{L})/gu, "");
  return unstarred
    .split(/\s+/)
    .map(unmixScripts)
    .join(" ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");
}

/** Те же слова одной строкой с пробелами по краям: для поиска фраз целыми словами. */
export function paddedNormalized(text: string): string {
  return ` ${normalizedWords(text).join(" ")} `;
}
