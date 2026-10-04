import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { timingsSql } from "./repository";

const dialect = new PgDialect();
const render = (input: Parameters<typeof timingsSql>[0]) => dialect.sqlToQuery(timingsSql(input));
const now = new Date("2026-10-03T12:00:00.000Z");

describe("timingsSql", () => {
  it("start: текущий step_timings справа от `||`, поэтому первый startedAt не затирается", () => {
    const q = render({ start: ["write"], now });
    expect(q.sql).toContain('|| "generations"."step_timings"');
    expect(q.params).toEqual(["write", now.toISOString()]);
  });

  it("finish: jsonb_set по пути {шаг,finishedAt}, значения только параметрами", () => {
    const q = render({ finish: ["write"], now });
    expect(q.sql).toContain("jsonb_set(");
    expect(q.sql).toContain("IS NULL THEN");
    expect(q.params).toContain("{write,finishedAt}");
    expect(q.params).toContain(now.toISOString());
  });

  it("без start и finish: колонка как есть", () => {
    expect(render({ now }).sql).toBe('"generations"."step_timings"');
  });
});
