import type { Level, PersonaProfile, Tier } from "@/contracts";
import { forbiddenTopics } from "../../analyze/forbidden";
import { hookCount } from "./config";
import type { Hook, HookKind } from "./types";

// Выбор крючков (roast-engine §5.2): чистый код. Из `observations` берём `safe`, не пересекающиеся
// с `avoidTopics ∪ sensitiveEvents`, по убыванию `recognizability`; среди них хотя бы один
// с цифрой и, если есть, разных типов.

const CONTENT_FACT = /^fact:(?:hashtag|location|word):/;
const ANY_FACT = /^fact:/;
const NUMERIC_FACT = /^fact:[a-z][A-Za-z]*:[^=]*=-?\d|^fact:[a-z][A-Za-z]*:-?\d/;

export function classifyKind(evidence: readonly string[]): HookKind {
  if (evidence.some((e) => CONTENT_FACT.test(e))) return "content";
  if (evidence.some((e) => ANY_FACT.test(e))) return "rhythm";
  return "habit";
}

/** Цифра есть в опорах-фактах («=47») или прямо в формулировке («40 сторис»). */
export function hasNumber(claim: string, evidence: readonly string[]): boolean {
  return /\d/.test(claim) || evidence.some((e) => NUMERIC_FACT.test(e));
}

const WORD = /[\p{L}\p{N}]+/gu;
const STEM = 5;

/**
 * Пересекается ли наблюдение с запретной темой. Намеренно грубо и в сторону осторожности:
 * подстрока темы целиком или совпадение основы (первые 5 букв) любого слова длиннее трёх букв.
 * Потерять крючок дешевле, чем пошутить про потерю близкого.
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

/** Все подходящие под правила наблюдения, лучшие первыми (при равенстве порядок досье). */
export function eligibleHooks(persona: PersonaProfile): Hook[] {
  const forbidden = forbiddenTopics(persona);
  return (persona.observations ?? [])
    .filter((o) => o.safe && !overlapsForbidden(o.claim, forbidden))
    .map((o) => ({
      id: o.id,
      claim: o.claim,
      evidence: o.evidence,
      recognizability: o.recognizability,
      kind: classifyKind(o.evidence),
      hasNumber: hasNumber(o.claim, o.evidence),
    }))
    .map((h, order) => ({ h, order }))
    .sort((a, b) => b.h.recognizability - a.h.recognizability || a.order - b.order)
    .map(({ h }) => h);
}

const MIN_RECOGNIZABILITY_FOR_SWAP = 3;

/** Заменить самый слабый элемент `chosen`, который можно отдать (`canGive`), на `incoming`. */
function swapIn(chosen: Hook[], incoming: Hook, canGive: (h: Hook) => boolean): boolean {
  for (let i = chosen.length - 1; i >= 0; i--) {
    const victim = chosen[i];
    if (victim && canGive(victim)) {
      chosen[i] = incoming;
      return true;
    }
  }
  return false;
}

/**
 * `count` крючков из `eligible` (уже отсортированных): сначала лучшие, потом правки на
 * разнообразие типов и на цифру. Правки не выкидывают единственного представителя типа.
 */
export function pickHooks(eligible: readonly Hook[], count: number): Hook[] {
  if (count <= 0) return [];
  const chosen = eligible.slice(0, count);
  const rest = () => eligible.filter((h) => !chosen.includes(h));
  const kindCount = (k: HookKind) => chosen.filter((h) => h.kind === k).length;

  for (const kind of ["content", "rhythm", "habit"] as const) {
    if (kindCount(kind) > 0) continue;
    const incoming = rest().find(
      (h) => h.kind === kind && h.recognizability >= MIN_RECOGNIZABILITY_FOR_SWAP,
    );
    if (incoming) swapIn(chosen, incoming, (v) => kindCount(v.kind) > 1);
  }

  if (!chosen.some((h) => h.hasNumber)) {
    const incoming = rest().find((h) => h.hasNumber);
    if (incoming) {
      // Сначала не трогаем единственного представителя типа, потом отдаём любого.
      if (!swapIn(chosen, incoming, (v) => kindCount(v.kind) > 1))
        swapIn(chosen, incoming, () => true);
    }
  }

  return chosen
    .map((h, order) => ({ h, order }))
    .sort((a, b) => b.h.recognizability - a.h.recognizability || a.order - b.order)
    .map(({ h }) => h);
}

export function selectHooks(
  persona: PersonaProfile,
  level: Level,
  tier: Tier,
  exclude: ReadonlySet<string> = new Set(),
): Hook[] {
  const eligible = eligibleHooks(persona).filter((h) => !exclude.has(h.id));
  return pickHooks(eligible, hookCount(level, tier, eligible.length));
}
