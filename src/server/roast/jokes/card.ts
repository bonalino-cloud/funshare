import { z } from "zod";
import type { Level } from "@/contracts";

// Банк шуток (roast-engine.md §5.1). Схемы BE-only: наружу, во фронт и в контракты, не уходят.
// Модуль чистый (без БД и env), его импортируют тесты, CLI и схема БД.

export const JOKE_MECHANISMS = [
  "hyperbole",
  "reversal",
  "faux_compliment",
  "false_expectation",
  "list_escalation",
  "role_swap",
  "meta",
  "understatement",
  "template",
] as const;
export const JOKE_SLOTS = ["habit", "object", "place", "number", "time"] as const;
export const JOKE_HEATS = ["mild", "medium", "hard"] as const;
export const JOKE_TOPICS = [
  "behavior",
  "content",
  "lifestyle",
  "body",
  "health",
  "family",
  "sex",
  "meta",
] as const;

export const JokeMechanism = z.enum(JOKE_MECHANISMS);
export const JokeSlot = z.enum(JOKE_SLOTS);
export const JokeHeat = z.enum(JOKE_HEATS);
export const JokeTopic = z.enum(JOKE_TOPICS);

/** Темы, где красная линия абсолютна (§5.1): в примеры не идут никогда, только скелет. */
export const REDLINE_TOPICS: readonly JokeTopic[] = ["health", "family"];
/** Темы «только на well_done»: на rare/medium от них остаётся скелет. */
export const WELL_DONE_ONLY_TOPICS: readonly JokeTopic[] = ["body", "sex"];

/** Скелет попадает в промпт писателя, поэтому он однострочный и короткий. */
export const JokeSkeleton = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((s) => !/[\r\n]/.test(s), "skeleton в одну строку");

/** Разметка шутки: то, что ставит модель (и что можно править руками в CSV, кроме флагов). */
export const JokeLabel = z.object({
  mechanism: JokeMechanism,
  skeleton: JokeSkeleton,
  slots: z.array(JokeSlot).max(JOKE_SLOTS.length),
  heat: JokeHeat,
  topic: JokeTopic,
  redline: z.boolean(),
  wellDoneOnly: z.boolean(),
  nsfw: z.boolean(),
  transferable: z.boolean(),
});
export type JokeLabel = z.infer<typeof JokeLabel>;
export type JokeTopic = z.infer<typeof JokeTopic>;

/** Карточка банка = строка `joke_cards`. `usableAsExample` не хранится: это функция от уровня. */
export const JokeCard = JokeLabel.extend({
  id: z.string().min(1),
  /** «раздел + номер» из md: `s1#5`; у формул раздела 15 без номера — `s15#<порядковый>`. */
  source: z.string().regex(/^s\d+#\d+$/),
  section: z.number().int().positive(),
  /** Оригинал, только для внутреннего использования. */
  text: z.string().min(1),
  textHash: z.string().length(64),
  approved: z.boolean(),
  /** Обучаемый вес (§5.6), старт 0. */
  score: z.number(),
  labelVersion: z.string().min(1),
  labelModel: z.string().min(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type JokeCard = z.infer<typeof JokeCard>;

/**
 * Правила безопасности кодом, а не словом модели. Флаги только ужесточаются (OR): модель может
 * поставить `redline` сама, но снять его по теме — нет. `nsfw` из 🔞 в md приходит как `extraNsfw`.
 */
export function deriveFlags<T extends JokeLabel>(label: T, extraNsfw = false): T {
  return {
    ...label,
    redline: label.redline || REDLINE_TOPICS.includes(label.topic),
    wellDoneOnly: label.wellDoneOnly || WELL_DONE_ONLY_TOPICS.includes(label.topic),
    nsfw: label.nsfw || extraNsfw,
  };
}

export type CardFlags = Pick<JokeCard, "approved" | "redline" | "wellDoneOnly" | "nsfw">;

/**
 * Единый источник правды для JS и SQL (`conditions.ts`): что допускает уровень.
 * На rare/medium от `wellDoneOnly` и `nsfw` карточек остаётся только скелет.
 */
export function exampleAllowances(level: Level): { wellDoneOnly: boolean; nsfw: boolean } {
  const wellDone = level === "well_done";
  return { wellDoneOnly: wellDone, nsfw: wellDone };
}

/** Можно ли показывать текст шутки моделью как образец на этом уровне. */
export function usableAsExample(card: CardFlags, level: Level): boolean {
  const allow = exampleAllowances(level);
  return (
    card.approved &&
    !card.redline &&
    (allow.wellDoneOnly || !card.wellDoneOnly) &&
    (allow.nsfw || !card.nsfw)
  );
}

/** Скелет (механику без слов) можно брать и у redline-карточек, лишь бы одобрена. */
export function usableAsSkeleton(card: Pick<JokeCard, "approved">): boolean {
  return card.approved;
}
