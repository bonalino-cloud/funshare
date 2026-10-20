import type { PersonaProfile } from "@/contracts";

/**
 * Запретный список тем для `write` и фильтров: `avoidTopics ∪ sensitiveEvents` без дублей
 * (без учёта регистра и краёв). Намеренно считается здесь, а не пишется в `avoidTopics`:
 * лимит поля 10, обрезать чувствительную тему нельзя (комментарий в persona.ts).
 */
export function forbiddenTopics(
  persona: Pick<PersonaProfile, "avoidTopics" | "sensitiveEvents">,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of [...persona.avoidTopics, ...(persona.sensitiveEvents ?? [])]) {
    const key = topic.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(topic.trim());
  }
  return out;
}

const WORD = /[\p{L}\p{N}]+/gu;
const STEM = 5;

/**
 * Пересекается ли текст с запретной темой. Намеренно грубо и в сторону осторожности: подстрока
 * темы целиком или совпадение основы (первые 5 букв) любого слова длиннее трёх букв. Потерять
 * крючок (или строку досье) дешевле, чем пошутить про потерю близкого.
 */
export function overlapsForbidden(claim: string, topics: readonly string[]): boolean {
  const text = claim.toLowerCase();
  const claimStems = new Set((text.match(WORD) ?? []).map((w) => w.slice(0, STEM)));
  for (const topic of topics) {
    const t = topic.toLowerCase().trim();
    if (t === "") continue;
    if (text.includes(t)) return true;
    for (const w of t.match(WORD) ?? []) {
      if (w.length > 3 && claimStems.has(w.slice(0, STEM))) return true;
    }
  }
  return false;
}
