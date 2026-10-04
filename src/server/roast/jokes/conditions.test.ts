import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { Level } from "@/contracts";
import { exampleAllowances } from "./card";
import { exampleWhere, skeletonWhere } from "./conditions";

const dialect = new PgDialect();

// Условие SQL и чистая функция строятся от `exampleAllowances`; тест сверяет, что в SQL ровно
// те ограничения, которых нет в послаблениях уровня.
describe("exampleWhere согласован с usableAsExample", () => {
  it.each<Level>(["rare", "medium", "well_done"])("%s", (level) => {
    const allow = exampleAllowances(level);
    const q = dialect.sqlToQuery(exampleWhere(level));
    expect(q.sql).toContain('"joke_cards"."approved" = $');
    expect(q.sql).toContain('"joke_cards"."redline" = $');
    expect(q.sql.includes('"joke_cards"."well_done_only"')).toBe(!allow.wellDoneOnly);
    expect(q.sql.includes('"joke_cards"."nsfw"')).toBe(!allow.nsfw);
    // approved = true, остальные ограничения = false.
    expect(q.params).toEqual([
      true,
      false,
      ...(allow.wellDoneOnly ? [] : [false]),
      ...(allow.nsfw ? [] : [false]),
    ]);
  });

  it("skeletonWhere: только approved", () => {
    const q = dialect.sqlToQuery(skeletonWhere());
    expect(q.sql).toBe('"joke_cards"."approved" = $1');
    expect(q.params).toEqual([true]);
  });
});
