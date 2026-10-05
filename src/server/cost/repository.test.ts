import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const set = vi.fn();
const where = vi.fn(async () => undefined);
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  db: () => ({
    update: () => ({
      set: (values: unknown) => {
        set(values);
        return { where };
      },
    }),
  }),
}));

import { CostMeter } from "./meter";
import { addStepCostSet, createGenerationCostRepository } from "./repository";

const dialect = new PgDialect();
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

function run(tokens = 1000) {
  const m = new CostMeter();
  m.recordLlm({
    role: "writer",
    model: "claude-sonnet-5",
    usage: { inputTokens: tokens },
    ok: true,
  });
  return m.snapshot();
}

describe("addStepCostSet: атомарный UPDATE стоимости генерации", () => {
  const r = run();
  const parts = addStepCostSet("write", r);

  it("микро-USD складываются в БД, а не в коде", () => {
    const q = dialect.sqlToQuery(parts.costMicroUsd);
    expect(flat(q.sql)).toBe('"generations"."cost_micro_usd" + $1::int');
    expect(q.params).toEqual([r.microUsd]);
  });

  it("центы = ceil(сумма микро-USD / 10000) от ИТОГА", () => {
    const q = dialect.sqlToQuery(parts.costCents);
    expect(flat(q.sql)).toBe(
      'ceil(("generations"."cost_micro_usd" + $1::int)::numeric / 10000)::int',
    );
  });

  it("разбивка: прогон дописывается в массив шага, прежние остаются", () => {
    const q = dialect.sqlToQuery(parts.costDetail);
    const text = flat(q.sql);
    expect(text).toContain('jsonb_set("generations"."cost_detail"');
    expect(text).toContain("|| jsonb_build_array(");
    expect(text).toContain("coalesce(");
    expect(q.params).toContain("{write}");
    expect(q.params).toContain("write");
    expect(q.params).toContain(JSON.stringify(r));
  });

  it("шаг передаётся параметром, а не склеивается в SQL", () => {
    const evil = dialect.sqlToQuery(addStepCostSet("w}; DROP TABLE x;--", r).costDetail);
    expect(evil.sql).not.toContain("DROP");
  });
});

describe("createGenerationCostRepository", () => {
  it("пишет в строку своей генерации", async () => {
    await createGenerationCostRepository().addStepCost("g1", "write", run());
    expect(set).toHaveBeenCalledTimes(1);
    expect(Object.keys(set.mock.calls[0]?.[0] as object).sort()).toEqual([
      "costCents",
      "costDetail",
      "costMicroUsd",
    ]);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("не пишет то, что не прошло схему", async () => {
    set.mockClear();
    const bad = { ...run(), microUsd: -1 };
    await expect(
      createGenerationCostRepository().addStepCost("g1", "write", bad),
    ).rejects.toThrow();
    expect(set).not.toHaveBeenCalled();
  });
});
