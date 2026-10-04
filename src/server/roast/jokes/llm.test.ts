import { generateText, Output } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { LABEL_BATCH_JSON_SCHEMA } from "./llm";

const good = {
  id: 0,
  mechanism: "meta",
  skeleton: "{Действие} звучит как {достижение}",
  slots: ["habit"],
  heat: "mild",
  topic: "meta",
  redline: false,
  wellDoneOnly: false,
  nsfw: false,
  transferable: true,
};
// Скелет длиннее лимита схемы: zod его отвергнет, JSON Schema у модели этого не запретит.
const bad = { ...good, id: 1, skeleton: "x".repeat(301) };

describe("LABEL_BATCH_JSON_SCHEMA", () => {
  it("SDK не валидирует пакет целиком: одна кривая карточка не роняет остальные", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        ({
          content: [{ type: "text", text: JSON.stringify({ items: [good, bad] }) }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        }) as never,
    });
    const { output } = await generateText({
      model,
      prompt: "x",
      output: Output.object({ schema: LABEL_BATCH_JSON_SCHEMA }),
    });
    expect((output as { items: unknown[] }).items).toHaveLength(2);
  });

  it("модель получает ту же схему пакета, что строит SDK из zod", async () => {
    const schema = JSON.stringify(await LABEL_BATCH_JSON_SCHEMA.jsonSchema);
    expect(schema).toContain("faux_compliment");
    expect(schema).toContain("wellDoneOnly");
  });
});
