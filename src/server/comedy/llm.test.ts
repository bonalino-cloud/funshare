import { afterEach, describe, expect, it, vi } from "vitest";
import { NoObjectGeneratedError } from "ai";
import { LlmSchemaError } from "../analyze/llm";
import { CostMeter } from "../cost/meter";
import { CANARIES } from "../prompts/canary";
import { COMEDY_BUDGET_MS, MIN_CALL_MS } from "./config";
import { defaultComedyDeps } from "./engine";
import { formatCostLog } from "../cost/meter";
import {
  COMEDY_ROLES,
  ComedyDeadlineError,
  comedyModels,
  comedyRoleConfig,
  createComedyGenerate,
  HAIKU_MODEL,
  SONNET_MODEL,
  type ComedyRole,
} from "./llm";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  generateText.mockReset();
});

const usage = { inputTokens: 1000, outputTokens: 200 };

describe("модели, размышления и effort по ролям", () => {
  it("сочиняют и оценивают Sonnet 5.5 с between_tools, модерирует Haiku 5.5 без размышлений", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    generateText.mockResolvedValue({ output: { ok: 1 }, finishReason: "stop", totalUsage: usage });
    const meter = new CostMeter();
    const sent: Record<string, { model: string; thinking: unknown; effort: unknown }> = {};
    for (const role of COMEDY_ROLES) {
      generateText.mockClear();
      await createComedyGenerate(role, { meter })({ system: "s", parts: [] });
      const call = generateText.mock.calls[0]?.[0] as {
        model: { modelId: string };
        providerOptions: { anthropic: { thinking: unknown; effort: unknown } };
      };
      sent[role] = {
        model: call.model.modelId,
        thinking: call.providerOptions.anthropic.thinking,
        effort: call.providerOptions.anthropic.effort,
      };
    }
    for (const role of ["profile", "insights", "select", "punch", "editor"] as const) {
      expect(sent[role]).toMatchObject({
        model: SONNET_MODEL,
        thinking: { type: "between_tools" },
      });
    }
    expect(sent.moderator).toMatchObject({ model: HAIKU_MODEL, thinking: { type: "disabled" } });
    for (const role of COMEDY_ROLES)
      expect(["low", "medium", "high"]).toContain(sent[role]!.effort);
    // Модель роли — в счётчике, цена известна и сверена: в логе нет пометки «оценка».
    const run = meter.snapshot();
    expect(new Set(run.llm.map((l) => l.model))).toEqual(new Set([SONNET_MODEL, HAIKU_MODEL]));
    expect(run.llm.find((l) => l.role === "comedy-moderator")?.model).toBe(HAIKU_MODEL);
    // 1000 вход + 200 выход: Haiku 5.5 $0.10 / $0.50 → 200 мкUSD, Sonnet 5.5 $2 / $10 → 4000.
    expect(run.llm.find((l) => l.role === "comedy-moderator")?.microUsd).toBe(200);
    expect(run.llm.find((l) => l.role === "comedy-punch")?.microUsd).toBe(4000);
    expect(run.estimated).toBe(false);
    expect(formatCostLog("write", run)).not.toContain("оценка");
  });

  it("Sonnet 5.5 никогда не получает disabled (400 у провайдера)", () => {
    for (const role of COMEDY_ROLES) {
      const cfg = comedyRoleConfig(role);
      if (cfg.model === SONNET_MODEL) expect(cfg.thinking).not.toBe("disabled");
    }
    expect(comedyModels()).toEqual({
      profile: SONNET_MODEL,
      insights: SONNET_MODEL,
      select: SONNET_MODEL,
      punch: SONNET_MODEL,
      editor: SONNET_MODEL,
      moderator: HAIKU_MODEL,
    });
  });
});

describe("createComedyGenerate", () => {
  it("метка canary своей природы, роль счётчика comedy-*, картинки уходят файлами", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    generateText.mockResolvedValue({ output: { ok: 1 }, finishReason: "stop", totalUsage: usage });
    const meter = new CostMeter();
    const cases: [ComedyRole, string][] = [
      ["profile", CANARIES.analyze],
      ["insights", CANARIES.writer],
      ["select", CANARIES.judge],
      ["punch", CANARIES.writer],
      ["editor", CANARIES.judge],
      ["moderator", CANARIES.moderator],
    ];
    for (const [role, canary] of cases) {
      generateText.mockClear();
      const out = await createComedyGenerate(role, { meter })({
        system: "СИСТЕМА",
        parts: [
          { type: "text", text: "Аватар" },
          { type: "image", data: new Uint8Array([1]), mediaType: "image/jpeg" },
        ],
      });
      expect(out).toEqual({ ok: 1 });
      const call = generateText.mock.calls[0]?.[0] as {
        system: string;
        messages: { content: { type: string }[] }[];
      };
      expect(call.system.startsWith("СИСТЕМА")).toBe(true);
      expect(Object.values(CANARIES).filter((c) => call.system.includes(c))).toEqual([canary]);
      expect(call.messages[0]?.content.map((c) => c.type)).toEqual(["text", "file"]);
    }
    const roles = meter
      .snapshot()
      .llm.map((l) => l.role)
      .sort();
    expect(roles).toEqual([
      "comedy-editor",
      "comedy-insights",
      "comedy-moderator",
      "comedy-profile",
      "comedy-punch",
      "comedy-select",
    ]);
  });

  it("ответ не по схеме: LlmSchemaError без текста ответа, неудачный вызов посчитан с токенами", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateText.mockRejectedValue(
      new NoObjectGeneratedError({
        message: "x",
        text: "секретный ответ модели",
        response: { id: "r", timestamp: new Date(), modelId: "m" },
        usage: { inputTokens: 10, outputTokens: 5 } as never,
        finishReason: "length",
      }),
    );
    const meter = new CostMeter();
    const err = await createComedyGenerate("punch", { meter })({ system: "s", parts: [] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LlmSchemaError);
    expect(String((err as Error).message)).not.toContain("секретный");
    const [line] = meter.snapshot().llm;
    expect(line).toMatchObject({ role: "comedy-punch", calls: 1, failedCalls: 1, outputTokens: 5 });
  });

  it("общий срок: таймаут вызова не дальше срока; у срока вызов не начинается и не стоит денег", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    generateText.mockResolvedValue({ output: { ok: 1 }, finishReason: "stop", totalUsage: usage });
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const prompt = { system: "s", parts: [] };

    await createComedyGenerate("punch")(prompt);
    expect(timeout).toHaveBeenLastCalledWith(comedyRoleConfig("punch").timeoutMs);

    await createComedyGenerate("punch", { deadlineAt: Date.now() + 30_000 })(prompt);
    const budgeted = timeout.mock.lastCall?.[0] ?? 0;
    expect(budgeted).toBeLessThanOrEqual(30_000);
    expect(budgeted).toBeGreaterThan(25_000);

    generateText.mockClear();
    const meter = new CostMeter();
    const late = createComedyGenerate("profile", {
      meter,
      deadlineAt: Date.now() + MIN_CALL_MS - 1,
    });
    await expect(late(prompt)).rejects.toBeInstanceOf(ComedyDeadlineError);
    expect(generateText).not.toHaveBeenCalled();
    expect(meter.snapshot().llm).toEqual([]);
  });

  it("боевые зависимости: один срок COMEDY_BUDGET_MS на все роли запуска", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    generateText.mockResolvedValue({ output: { ok: 1 }, finishReason: "stop", totalUsage: usage });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T12:00:00Z") });
    try {
      const deps = defaultComedyDeps();
      vi.setSystemTime(Date.now() + COMEDY_BUDGET_MS - MIN_CALL_MS - 1_000);
      await expect(deps.moderator({ system: "s", parts: [] })).resolves.toEqual({ ok: 1 });
      vi.setSystemTime(Date.now() + 2_000);
      await expect(deps.punch({ system: "s", parts: [] })).rejects.toBeInstanceOf(
        ComedyDeadlineError,
      );
      expect(generateText).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("нет ключа: ошибка до вызова модели", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(createComedyGenerate("select")({ system: "s", parts: [] })).rejects.toThrow(
      "ANTHROPIC_API_KEY",
    );
    expect(generateText).not.toHaveBeenCalled();
  });
});
