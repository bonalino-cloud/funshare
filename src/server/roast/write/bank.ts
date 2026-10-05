import type { Level } from "@/contracts";
import type { JokeLabel } from "../jokes/card";
import type { RuntimeCard } from "../jokes/repository";
import {
  EXAMPLES_PER_HOOK,
  HEATS_BY_LEVEL,
  MIN_CARD_SCORE,
  RARE_SKELETON_MECHANISMS,
  SKELETONS_PER_HOOK,
} from "./config";
import type { Hook, HookKind, HookStyle, StyleCard } from "./types";

// Подбор стиля из банка (roast-engine §5.3): чистый код поверх `listCards`.
// Банк уже отфильтрован SQL по одобрению и красным линиям (`usableAsExample` / `usableAsSkeleton`).

export type BankCards = { skeletons: RuntimeCard[]; examples: RuntimeCard[] };

/** Слоты, которые нужны крючку этого типа: по ним ищем подходящие скелеты. */
function wantedSlots(hook: Hook): JokeLabel["slots"][number][] {
  const byKind: Record<HookKind, JokeLabel["slots"][number][]> = {
    content: ["object", "place"],
    rhythm: ["number", "time"],
    habit: ["habit"],
  };
  return hook.hasNumber ? [...byKind[hook.kind], "number"] : byKind[hook.kind];
}

function affinity(card: RuntimeCard, wanted: readonly JokeLabel["slots"][number][]): number {
  return card.slots.filter((s) => wanted.includes(s)).length;
}

const eligibleScore = (c: RuntimeCard) => c.score >= MIN_CARD_SCORE;

/**
 * Скелеты уровня: на rare только `faux_compliment` / `understatement` и `mild`; иначе по `heat`
 * уровня. Образцы: тот же `heat`, с текстом оригинала.
 */
export function filterBank(level: Level, bank: BankCards): BankCards {
  const heats = HEATS_BY_LEVEL[level];
  return {
    skeletons: bank.skeletons.filter(
      (c) =>
        eligibleScore(c) &&
        heats.includes(c.heat) &&
        (level !== "rare" || RARE_SKELETON_MECHANISMS.includes(c.mechanism)),
    ),
    examples: bank.examples.filter(
      (c) => eligibleScore(c) && heats.includes(c.heat) && c.text !== null && c.text !== "",
    ),
  };
}

type Usage = { mechanisms: Map<string, number>; cards: Map<string, number> };

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * Для каждого крючка: до 2 скелетов (разные механики, по слотам крючка, механики, которых в
 * артефакте уже меньше, идут первыми, чтобы не повторять один приём чаще двух раз, пока есть
 * выбор) и до 3 образцов (не повторяя образец у разных крючков, пока банк позволяет).
 * Порядок банка (`score` по убыванию, затем `source`) решает ничьи: подбор детерминирован.
 */
export function pickStyles(hooks: readonly Hook[], level: Level, bank: BankCards): HookStyle[] {
  const { skeletons, examples } = filterBank(level, bank);
  const usage: Usage = { mechanisms: new Map(), cards: new Map() };

  return hooks.map((hook) => {
    const wanted = wantedSlots(hook);

    const pickedSk: RuntimeCard[] = [];
    const pool = skeletons.map((card, order) => ({ card, order }));
    while (pickedSk.length < SKELETONS_PER_HOOK) {
      const candidates = pool.filter(
        ({ card }) =>
          !pickedSk.includes(card) && !pickedSk.some((p) => p.mechanism === card.mechanism),
      );
      const best = candidates.sort(
        (a, b) =>
          (usage.mechanisms.get(a.card.mechanism) ?? 0) -
            (usage.mechanisms.get(b.card.mechanism) ?? 0) ||
          affinity(b.card, wanted) - affinity(a.card, wanted) ||
          (usage.cards.get(a.card.id) ?? 0) - (usage.cards.get(b.card.id) ?? 0) ||
          a.order - b.order,
      )[0];
      if (!best) break;
      pickedSk.push(best.card);
      bump(usage.mechanisms, best.card.mechanism);
      bump(usage.cards, best.card.id);
    }

    const pickedEx = examples
      .map((card, order) => ({ card, order }))
      .sort(
        (a, b) =>
          (usage.cards.get(`ex:${a.card.id}`) ?? 0) - (usage.cards.get(`ex:${b.card.id}`) ?? 0) ||
          a.order - b.order,
      )
      .slice(0, EXAMPLES_PER_HOOK)
      .map(({ card }) => card);
    for (const card of pickedEx) bump(usage.cards, `ex:${card.id}`);

    const toStyle =
      (prefix: string) =>
      (card: RuntimeCard, i: number): StyleCard => ({
        ref: `${prefix}${i + 1}`,
        cardId: card.id,
        mechanism: card.mechanism,
        skeleton: card.skeleton,
        text: card.text,
      });
    return {
      hook,
      skeletons: pickedSk.map(toStyle("s")),
      examples: pickedEx.map(toStyle("e")),
    };
  });
}
