import { and, eq, type SQL } from "drizzle-orm";
import type { Level } from "@/contracts";
import { jokeCards } from "../../db/schema";
import { exampleAllowances } from "./card";

// SQL-условия «карточка годится». Строятся от тех же `exampleAllowances`, что и функции
// `usableAsExample` / `usableAsSkeleton` в card.ts: правило в одном месте, тест сверяет оба вида.

export function exampleWhere(level: Level): SQL {
  const allow = exampleAllowances(level);
  const conditions = [
    eq(jokeCards.approved, true),
    eq(jokeCards.redline, false),
    ...(allow.wellDoneOnly ? [] : [eq(jokeCards.wellDoneOnly, false)]),
    ...(allow.nsfw ? [] : [eq(jokeCards.nsfw, false)]),
  ];
  // `and` с непустым списком всегда возвращает SQL.
  return and(...conditions) as SQL;
}

export function skeletonWhere(): SQL {
  return eq(jokeCards.approved, true);
}
