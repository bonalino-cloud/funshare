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
