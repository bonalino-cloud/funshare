import { describe, expect, it } from "vitest";
import { CostMeter, CostRun, formatCostLog, microUsdToCents } from "./meter";
import { APIFY_PRICE, MODEL_PRICES, PRICES_CHECKED_AT, priceForModel } from "./prices";

const M = "claude-sonnet-5";

describe("microUsdToCents", () => {
  it("округляет вверх, ноль остаётся нулём", () => {
    expect(microUsdToCents(0)).toBe(0);
    expect(microUsdToCents(1)).toBe(1);
    expect(microUsdToCents(10_000)).toBe(1);
    expect(microUsdToCents(10_001)).toBe(2);
  });
});

describe("CostMeter: LLM", () => {
  it("суммирует токены вызовов одной роли и считает цену по прайсу", () => {
    const m = new CostMeter();
    m.recordLlm({
      role: "writer",
      model: M,
      usage: { inputTokens: 1000, outputTokens: 500 },
      ok: true,
    });
    m.recordLlm({
      role: "writer",
      model: M,
      usage: { inputTokens: 3000, outputTokens: 500 },
      ok: true,
    });
    const run = m.snapshot();
    expect(run.llm).toHaveLength(1);
    expect(run.llm[0]).toMatchObject({
      role: "writer",
      calls: 2,
      failedCalls: 0,
      inputTokens: 4000,
      outputTokens: 1000,
    });
    // 4000 * $2/M + 1000 * $10/M = $0.018
    expect(run.microUsd).toBe(18_000);
    expect(run.pricesAsOf).toBe(PRICES_CHECKED_AT);
    expect(run.estimated).toBe(false); // известная сверенная модель
  });

  it("неудачные вызовы и ретраи учитываются: с токенами и без", () => {
    const m = new CostMeter();
    m.recordLlm({
      role: "judge",
      model: M,
      usage: { inputTokens: 100, outputTokens: 4096 },
      ok: false,
    });
    m.recordLlm({ role: "judge", model: M, ok: false }); // сеть упала, usage нет
    m.recordLlm({
      role: "judge",
      model: M,
      usage: { inputTokens: 100, outputTokens: 50 },
      ok: true,
    });
    const line = m.snapshot().llm[0];
    expect(line).toMatchObject({ calls: 3, failedCalls: 2, inputTokens: 200, outputTokens: 4146 });
  });

  it("роли и модели считаются отдельными строками", () => {
    const m = new CostMeter();
    m.recordLlm({ role: "writer", model: M, usage: { inputTokens: 1, outputTokens: 1 }, ok: true });
    m.recordLlm({ role: "judge", model: M, usage: { inputTokens: 1, outputTokens: 1 }, ok: true });
    m.recordLlm({
      role: "judge",
      model: "other",
      usage: { inputTokens: 1, outputTokens: 1 },
      ok: true,
    });
    expect(m.snapshot().llm.map((l) => `${l.role}/${l.model}`)).toEqual([
      "writer/claude-sonnet-5",
      "judge/claude-sonnet-5",
      "judge/other",
    ]);
  });

  it("кэш-токены: без пересечения со входом, цена по своим тарифам", () => {
    const m = new CostMeter();
    m.recordLlm({
      role: "analyze",
      model: M,
      usage: {
        inputTokens: 10_000,
        outputTokens: 0,
        inputTokenDetails: { noCacheTokens: 1000, cacheReadTokens: 8000, cacheWriteTokens: 1000 },
      },
      ok: true,
    });
    const run = m.snapshot();
    expect(run.llm[0]).toMatchObject({
      inputTokens: 1000,
      cacheReadTokens: 8000,
      cacheWriteTokens: 1000,
    });
    expect(MODEL_PRICES[M]).toBeDefined();
    // 1000*2 + 8000*0.2 + 1000*2.5 = 2000 + 1600 + 2500 = 6100 микро-USD
    expect(run.microUsd).toBe(6100);
  });

  it("noCacheTokens нет: вход минус кэш", () => {
    const m = new CostMeter();
    m.recordLlm({
      role: "analyze",
      model: M,
      usage: { inputTokens: 1000, inputTokenDetails: { cacheReadTokens: 400 } },
      ok: true,
    });
    expect(m.snapshot().llm[0]).toMatchObject({ inputTokens: 600, cacheReadTokens: 400 });
  });

  it("мусор в usage (NaN, минус, Infinity) не ломает и не уходит в деньги", () => {
    const m = new CostMeter();
    m.recordLlm({
      role: "writer",
      model: M,
      usage: {
        inputTokens: Number.NaN,
        outputTokens: -5,
        inputTokenDetails: { cacheReadTokens: Infinity },
      },
      ok: true,
    });
    const run = m.snapshot();
    expect(run.microUsd).toBe(0);
    expect(CostRun.safeParse(run).success).toBe(true);
  });

  it("неизвестная модель: цена по самой дорогой записи, estimated", () => {
    const m = new CostMeter();
    m.recordLlm({ role: "writer", model: "mystery", usage: { inputTokens: 1_000_000 }, ok: true });
    const run = m.snapshot();
    expect(run.estimated).toBe(true);
    expect(run.microUsd).toBe(2_000_000);
    expect(priceForModel("mystery").known).toBe(false);
    expect(priceForModel("mystery").price.verified).toBe(false);
  });
});

describe("округление: центы только от итога", () => {
  it("много дешёвых вызовов не раздувают центы по одному", () => {
    const m = new CostMeter();
    // Один вызов ≈ $0.0007: по отдельности каждый округлился бы вверх до цента.
    for (let i = 0; i < 10; i++) {
      m.recordLlm({
        role: "judge",
        model: M,
        usage: { inputTokens: 200, outputTokens: 30 },
        ok: true,
      });
    }
    const run = m.snapshot();
    expect(run.microUsd).toBe(7000);
    expect(microUsdToCents(run.microUsd)).toBe(1); // а не 10
  });
});

describe("CostMeter: Apify", () => {
  it("оценка: результаты × тариф; помечена estimate", () => {
    const m = new CostMeter();
    m.recordApify({ results: 1 });
    const run = m.snapshot();
    expect(run.apify).toEqual({
      actor: APIFY_PRICE.actor,
      attempts: 1,
      results: 1,
      microUsd: 2600,
      source: "estimate",
    });
    // цена за результат сверена, поэтому прогон не estimated; оценочность строки Apify — source
    expect(run.estimated).toBe(false);
    expect(run.microUsd).toBe(2600);
  });

  it("несверенная цена (известная модель или Apify) делает прогон estimated", () => {
    const model = MODEL_PRICES[M];
    if (!model) throw new Error("нет цены модели");
    const saved = { model: model.verified, apify: APIFY_PRICE.verified };
    const run = (modelVerified: boolean, apifyVerified: boolean) => {
      try {
        model.verified = modelVerified;
        APIFY_PRICE.verified = apifyVerified;
        const m = new CostMeter();
        m.recordLlm({ role: "writer", model: M, usage: { inputTokens: 1 }, ok: true });
        m.recordApify({ results: 1 });
        return m.snapshot().estimated;
      } finally {
        model.verified = saved.model;
        APIFY_PRICE.verified = saved.apify;
      }
    };
    expect(run(false, true)).toBe(true);
    expect(run(true, false)).toBe(true);
    expect(run(true, true)).toBe(false);
  });

  it("сбой без ответа: попытка есть, денег нет", () => {
    const m = new CostMeter();
    m.recordApify({ results: 0 });
    expect(m.snapshot().apify).toMatchObject({ attempts: 1, results: 0, microUsd: 0 });
  });

  it("без обращений apify = null", () => {
    expect(new CostMeter().snapshot().apify).toBeNull();
  });
});

describe("formatCostLog", () => {
  it("только числа и имена ролей, одна строка", () => {
    const m = new CostMeter();
    m.recordLlm({
      role: "writer",
      model: M,
      usage: { inputTokens: 1000, outputTokens: 500 },
      ok: true,
    });
    m.recordApify({ results: 1 });
    const line = formatCostLog("write", m.snapshot());
    expect(line).not.toContain("\n");
    expect(line).toContain("[cost] write");
    expect(line).toContain("вход=1000 выход=500");
    expect(line).toContain("writer:1/0");
    expect(line).toContain("центов=1");
  });
});
