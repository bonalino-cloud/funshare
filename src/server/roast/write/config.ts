import type { Level, Tier } from "@/contracts";
import { TIERS } from "../../pricing/config";
import type { JokeLabel } from "../jokes/card";

// Настройки шага `write`. Числа из roast-engine §5.2, §5.3, §5.5, §6 «Итог».

/** Крючков по степени (§5.2): 5 / 6 / 8. */
export const HOOKS_BY_LEVEL: Record<Level, number> = { rare: 5, medium: 6, well_done: 8 };

/** Минимум шуток в выдаче (§6 «Итог»): меньше — не выдаём слабое, шаг падает в `internal`. */
export const MIN_CANDIDATES_BY_LEVEL: Record<Level, number> = {
  rare: 5,
  medium: 6,
  well_done: 8,
};

/** Кандидатов на крючок (§5.4). */
export const CANDIDATES_PER_HOOK = 3;

/** Раундов писателя: второй — запасные кандидаты, если после судьи слишком мало (§6 «Итог»). */
export const MAX_ROUNDS = 2;

/** Попыток вызова модели на один вызов: первая и два ретрая (как в `analyze`). */
export const MAX_ATTEMPTS = 3;

/** Размер пачки: ответ модели ограничен независимо от тарифа (иначе обрезка по токенам). */
export const WRITER_HOOKS_PER_CALL = 5;
export const JUDGE_CANDIDATES_PER_CALL = 12;

/** Скелеты и образцы на крючок (§5.3). */
export const SKELETONS_PER_HOOK = 2;
export const EXAMPLES_PER_HOOK = 3;
/** Карточки с обучаемым весом ниже порога из подбора исключаются (§5.3). */
export const MIN_CARD_SCORE = -1;

/** Порог судьи по критериям «про поведение» и «тепло» (§5.5): ниже — кандидат вырезается. */
export function judgeThresholds(level: Level): { aboutBehavior: number; warmth: number } {
  // Жёсткий режим — роаст-баттл: тепло в самих панчах не обязательно, оно в финале.
  return { aboutBehavior: 3, warmth: level === "well_done" ? 2 : 3 };
}

/** Какие `heat` брать в образцы и скелеты по степени (§5.3). */
export const HEATS_BY_LEVEL: Record<Level, readonly JokeLabel["heat"][]> = {
  rare: ["mild"],
  medium: ["mild", "medium"],
  well_done: ["medium", "hard"],
};

/** На rare берём только эти механики скелетов (§5.3). */
export const RARE_SKELETON_MECHANISMS: readonly JokeLabel["mechanism"][] = [
  "faux_compliment",
  "understatement",
];

/** Сколько новых шуток просим у тарифа: `candidateCount` тарифа (Поджог 10, Кострище 20). */
export function maxNewCandidates(tier: Tier): number {
  return TIERS[tier].candidateCount;
}

/**
 * Число крючков: по степени (§5.2), но не меньше половины от потолка тарифа. Иначе у Кострища
 * (до 20 шуток) на 5 крючков по 3 кандидата набралось бы 15 и меньше. Больше наблюдений не бывает.
 */
export function hookCount(level: Level, tier: Tier, available: number): number {
  const wanted = Math.max(HOOKS_BY_LEVEL[level], Math.ceil(maxNewCandidates(tier) / 2));
  return Math.min(wanted, available);
}

/** Потолок длины и язык: контракт `PUNCH_MAX_CHARS` берётся в `candidate.ts`. */
export const MIN_CYRILLIC_SHARE = 0.6;
