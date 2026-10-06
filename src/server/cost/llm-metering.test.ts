import { NoObjectGeneratedError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...args: unknown[]) => generateText(...args),
}));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => (id: string) => id }));

import { createAnthropicGenerate } from "../analyze/llm";
import { createAnthropicJudge, createAnthropicWriter } from "../roast/write/llm";
import { CostMeter } from "./meter";

const usage = (input: number, output: number) => ({
  inputTokens: input,
  outputTokens: output,
  inputTokenDetails: {
    noCacheTokens: input,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
  },
});

const prompt = { system: "s", user: "u" };

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  generateText.mockReset();
});

describe("учёт токенов в обёртке write (писатель, судья)", () => {
  it("успех: usage в счётчик под своей ролью, результат не меняется", async () => {
    const meter = new CostMeter();
    generateText.mockResolvedValue({
      output: { ok: 1 },
      finishReason: "stop",
      totalUsage: usage(1000, 200),
    });
    const out = await createAnthropicWriter(meter)(prompt);
    expect(out).toEqual({ ok: 1 });
    expect(meter.snapshot().llm).toEqual([
      expect.objectContaining({
        role: "writer",
        calls: 1,
        failedCalls: 0,
        inputTokens: 1000,
        outputTokens: 200,
      }),
    ]);
  });

  it("ответ не по схеме: токены считаются, ошибка та же (LlmSchemaError)", async () => {
    const meter = new CostMeter();
    generateText.mockRejectedValue(
      new NoObjectGeneratedError({
        message: "x",
        text: "{",
        response: { id: "r", timestamp: new Date(), modelId: "m" },
        usage: usage(500, 4096) as never,
        finishReason: "length",
      }),
    );
    await expect(createAnthropicJudge(meter)(prompt)).rejects.toMatchObject({
      name: "LlmSchemaError",
    });
    expect(meter.snapshot().llm[0]).toMatchObject({
      role: "judge",
      calls: 1,
      failedCalls: 1,
      inputTokens: 500,
      outputTokens: 4096,
    });
  });

  it("сетевой сбой: попытка есть, токенов нет, ошибка пробрасывается как была", async () => {
    const meter = new CostMeter();
    const boom = new Error("network");
    generateText.mockRejectedValue(boom);
    await expect(createAnthropicWriter(meter)(prompt)).rejects.toBe(boom);
    expect(meter.snapshot().llm[0]).toMatchObject({
      calls: 1,
      failedCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("нет вывода (геттер output бросает): один неудачный вызов, токены учтены", async () => {
    const meter = new CostMeter();
    const boom = new Error("No output generated.");
    generateText.mockResolvedValue({
      get output(): unknown {
        throw boom;
      },
      finishReason: "length",
      totalUsage: usage(700, 4096),
    });
    await expect(createAnthropicWriter(meter)(prompt)).rejects.toBe(boom);
    expect(meter.snapshot().llm).toEqual([
      expect.objectContaining({ calls: 1, failedCalls: 1, inputTokens: 700, outputTokens: 4096 }),
    ]);
  });

  it("без счётчика вызов работает как раньше", async () => {
    generateText.mockResolvedValue({
      output: { ok: 1 },
      finishReason: "stop",
      totalUsage: usage(1, 1),
    });
    await expect(createAnthropicWriter()(prompt)).resolves.toEqual({ ok: 1 });
  });
});

describe("учёт токенов в обёртке analyze", () => {
  const input = { system: "s", parts: [{ type: "text" as const, text: "t" }] };

  it("успех и неудача идут в роль analyze", async () => {
    const meter = new CostMeter();
    const generate = createAnthropicGenerate(meter);
    generateText.mockResolvedValueOnce({ output: { d: 1 }, totalUsage: usage(20_000, 3000) });
    await generate(input);
    generateText.mockRejectedValueOnce(new Error("timeout"));
    await expect(generate(input)).rejects.toThrow("timeout");
    expect(meter.snapshot().llm).toEqual([
      expect.objectContaining({
        role: "analyze",
        calls: 2,
        failedCalls: 1,
        inputTokens: 20_000,
        outputTokens: 3000,
      }),
    ]);
  });
});
