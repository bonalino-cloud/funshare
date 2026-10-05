// Логика проверки клиентского бандла на утечку промптов (roast-engine §8). Чистые функции:
// файлы и промпты приходят снаружи, тест лежит в `src/server/prompts/canary.test.ts`.

export type Needle = { kind: "canary" | "phrase"; value: string };
export type Leak = { file: string; needle: Needle };

/** Сколько знаков начала строки промпта берём как характерную фразу. */
const PHRASE_LENGTH = 40;
/** Короче фраза встречалась бы в любом тексте и давала ложные срабатывания. */
const MIN_PHRASE_LENGTH = 30;

/** Символы, из-за которых строка в минифицированном JS пишется иначе, чем в исходнике. */
const UNSAFE_IN_LITERAL = /["'`\\$]/;

/**
 * Что искать: canary-строки и начала строк системных промптов. Начало строки (40 знаков) короче
 * всего абзаца, поэтому находится и в обрезанном виде; фразы с кавычками и подстановками
 * пропускаем: в бандле они записаны по-другому.
 */
export function collectNeedles(
  canaries: readonly string[],
  promptTexts: readonly string[],
): Needle[] {
  const needles: Needle[] = canaries.map((value) => ({ kind: "canary", value }));
  const seen = new Set<string>();
  for (const text of promptTexts) {
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (line.length < MIN_PHRASE_LENGTH) continue;
      const phrase = line.slice(0, PHRASE_LENGTH);
      if (UNSAFE_IN_LITERAL.test(phrase) || seen.has(phrase)) continue;
      seen.add(phrase);
      needles.push({ kind: "phrase", value: phrase });
    }
  }
  return needles;
}

/** `\uXXXX` из минификатора превращаем обратно в буквы: кириллица может лежать в бандле так. */
export function decodeUnicodeEscapes(content: string): string {
  return content.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

export function findLeaks(
  files: readonly { path: string; content: string }[],
  needles: readonly Needle[],
): Leak[] {
  const leaks: Leak[] = [];
  for (const file of files) {
    const haystacks = [file.content, decodeUnicodeEscapes(file.content)];
    for (const needle of needles) {
      const target = needle.kind === "canary" ? needle.value.toLowerCase() : needle.value;
      const found = haystacks.some((h) =>
        (needle.kind === "canary" ? h.toLowerCase() : h).includes(target),
      );
      if (found) leaks.push({ file: file.path, needle });
    }
  }
  return leaks;
}
