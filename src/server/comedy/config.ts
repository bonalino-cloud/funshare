import type { Level } from "@/contracts";
import type { JOKE_MECHANISMS } from "../roast/jokes/card";
import type { Structure } from "./schema";

type JokeMechanism = (typeof JOKE_MECHANISMS)[number];

// Настройки comedy-движка (comedy-engine §1, §3, §4). Откат на старый движок — убрать степень
// из `COMEDY_LEVELS`: `runWriteStep` уйдёт в старый `writeCandidates`.

/** Степени, которые пишет comedy-движок. Остальные — старый писатель (roast-engine §5). */
export const COMEDY_LEVELS: readonly Level[] = ["well_done"];

export function isComedyLevel(level: Level): boolean {
  return COMEDY_LEVELS.includes(level);
}

/** Категории инсайтов: A контрасты, B неожиданные связи, C абсурдные интерпретации. */
export const INSIGHT_CATEGORIES = ["A", "B", "C"] as const;
export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

/** Сколько инсайтов просим у каждой категории: [от, до]. Больше «до» код отрезает. */
export const INSIGHTS_PER_CATEGORY: Record<InsightCategory, readonly [number, number]> = {
  A: [9, 11],
  B: [10, 12],
  C: [9, 11],
};

/** Инсайтов в работу (раунд 1) и в запас (раунд 2 при недоборе). */
export const WORK_INSIGHTS = 10;
export const RESERVE_INSIGHTS = 5;
/** Всего инсайтов в отборе: первые `WORK_INSIGHTS` в работу, остальные в запас. */
export const SELECT_INSIGHTS = WORK_INSIGHTS + RESERVE_INSIGHTS;

/** Шуток на инсайт. */
export const PUNCHES_PER_INSIGHT = 3;
/**
 * Инсайтов в одном вызове генератора: 10 инсайтов = 4 параллельных вызова (3+3+3+1). Ответ
 * короче, вызовы параллельны: раунд генератора идёт столько, сколько самый длинный из них.
 */
export const PUNCH_INSIGHTS_PER_CALL = 3;
/** Шуток в одном вызове модератора (два флага на шутку, ответ маленький). */
export const MODERATOR_PER_CALL = 12;
/** Раундов генератора: второй по запасным инсайтам, если после модератора меньше минимума. */
export const MAX_ROUNDS = 2;
/**
 * Проходов модератора на раунд: первый по выбору редактора, второй добирает вычеркнутых
 * следующими по сумме оценок редактора (показываем `maxNewCandidates(tier)`, §4).
 */
export const MODERATION_PASSES = 2;

/** Попыток на один вызов модели: первая и два ретрая (как в `write` и `analyze`). */
export const MAX_ATTEMPTS = 3;

/**
 * Бюджет времени всех вызовов модели одного запуска, мс, от сборки боевых зависимостей
 * (`defaultComedyDeps`, начало движка в шаге). Шаг `write` — один workflow-step с лимитом функции
 * 300 с. Без общего бюджета худший случай — 11 последовательных вызовов (профиль, инсайты, отбор,
 * по раунду генератор, редактор, два прохода модератора) × 3 попытки × таймаут роли ≈ 45 мин:
 * функцию убьют посреди платного вызова, а workflow повторит шаг целиком и заплатит ещё раз.
 * Таймаут вызова = min(таймаут роли, остаток бюджета); с запасом на БД до и после шаг ≤ ~240 с.
 */
export const COMEDY_BUDGET_MS = 225_000;
/** Если до конца бюджета меньше, вызов не начинаем: ответа не дождёмся, а токены спишут. */
export const MIN_CALL_MS = 5_000;

/** Обложек постов в материал (vision профиля) плюс аватар. */
export const MAX_IMAGES = 12;
/** Постов в материале из снимка Apify (подписи из `ProfileFacts.captionsForLlm`). */
export const MAX_MATERIAL_POSTS = 24;
/**
 * Потолок сырых байтов всех картинок одного запроса. Anthropic ограничивает запрос 32 МБ, base64
 * раздувает на треть. Обложки обычно уменьшены до 512 px (десятки КБ): потолок срабатывает,
 * только если ресайз не удался и ушли оригиналы.
 */
export const MAX_IMAGE_BYTES_TOTAL = 20 * 1024 * 1024;

/** Профиль с меньшим числом фактов не принимается (ретрай с причиной). */
export const MIN_PROFILE_FACTS = 5;

/** Потолки списков профиля (comedy-engine §3): лишнее код отрезает. */
export const PROFILE_LIMITS = {
  facts: 45,
  quotes: 10,
  audience: 6,
  unknowns: 10,
  closedTopics: 8,
} as const;

/** Опорных фактов у инсайта: 1–4. */
export const MAX_INSIGHT_FACTS = 4;
export const MAX_INSIGHT_DIRECTIONS = 2;

/** Порог ясности у редактора: ниже шутку не берём. */
export const MIN_CLARITY = 2;

/** Сколько шуток на один инсайт может войти в выдачу из `n`: 1 при n ≤ 10, 2 при n > 10. */
export function maxPerInsight(n: number): number {
  return n <= 10 ? 1 : 2;
}

/** Пакет вкуса в трассе кандидата (`PunchTrace.tastePack`). */
export const COMEDY_TASTE_PACK = "comedy/v1";

/**
 * Структура шутки → механика старой трассы (`PunchTrace.mechanism`, comedy-engine §5): старые
 * читатели трассы (админка, перенос в Кострище) видят знакомое поле.
 */
export const STRUCTURE_MECHANISM: Record<Structure, JokeMechanism> = {
  false_compliment: "faux_compliment",
  fact_fusion: "false_expectation",
  absurd_cause: "reversal",
  hybrid_image: "role_swap",
  analogy: "hyperbole",
  quote_twist: "meta",
  other: "template",
};
