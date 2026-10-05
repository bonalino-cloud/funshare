import { createHash } from "node:crypto";

// Нормализация и поиск дублей без эмбеддингов (в стеке нет провайдера эмбеддингов).
// TODO(embeddings): когда в стеке появятся эмбеддинги, заменить Jaccard на косинус по векторам
// и ловить перефразированные дубли; пока ловим только совпадения и близкие переписывания.

/** Нижний регистр, ё→е, без пунктуации и лишних пробелов. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Хэш карточки: нормализованный текст + пометка 🔞. Изменился = перезаписать разметку и сбросить approved. */
export function textHash(text: string, nsfw: boolean): string {
  return createHash("sha256")
    .update(normalizeText(text) + (nsfw ? "|18" : ""))
    .digest("hex");
}

/** Порог близости по словам: подобран на корпусе, ниже ловит ложные срабатывания на «шаблонах». */
export const DUPLICATE_JACCARD = 0.8;
/** Короткие тексты сравниваем только на точное совпадение: у них Jaccard шумит. */
const MIN_WORDS_FOR_FUZZY = 5;

function words(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter(Boolean));
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export type DupIndex = {
  /** Ищет ближайший уже добавленный текст; `key` — то, что передали в `add`. */
  find(text: string): string | null;
  add(key: string, text: string): void;
};

/** Индекс для поиска дублей: O(n) на запрос, для ~500 карточек этого достаточно. */
export function createDupIndex(): DupIndex {
  const exact = new Map<string, string>();
  const fuzzy: { key: string; words: Set<string> }[] = [];
  return {
    find(text) {
      const norm = normalizeText(text);
      const hit = exact.get(norm);
      if (hit !== undefined) return hit;
      const w = words(norm);
      if (w.size < MIN_WORDS_FOR_FUZZY) return null;
      for (const item of fuzzy) {
        if (item.words.size >= MIN_WORDS_FOR_FUZZY && jaccard(w, item.words) >= DUPLICATE_JACCARD) {
          return item.key;
        }
      }
      return null;
    },
    add(key, text) {
      const norm = normalizeText(text);
      if (!exact.has(norm)) exact.set(norm, key);
      fuzzy.push({ key, words: words(norm) });
    },
  };
}
