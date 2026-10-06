import { afterEach, describe, expect, it, vi } from "vitest";
import { collectNeedles, decodeUnicodeEscapes, findLeaks } from "../../../scripts/ci/bundle-leaks";
import { PROMPT_CANARIES } from "../roast/filters/config";
import { checkOutputText, hasCanary } from "../roast/filters";
import * as active from "./active";
import { ALL_CANARIES, CANARIES, withCanary } from "./canary";
import { allAnalyzeSystemPrompts, allWriteSystemPrompts } from "./registry";
import { JUDGE_SYSTEM } from "./roast/v1";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  generateText.mockReset();
});

describe("canary-строки", () => {
  it("по одной на роль, уникальны, достаточно длинные, без пробелов", () => {
    const values = Object.values(CANARIES);
    expect(new Set(values).size).toBe(values.length);
    expect(Object.keys(CANARIES).sort()).toEqual(["analyze", "judge", "moderator", "writer"]);
    for (const v of values) expect(v).toMatch(/^fsc-[a-z]-[0-9a-f]{12}$/);
  });

  it("слой 4 видит каждую: filters/config отдаёт все метки", () => {
    expect([...PROMPT_CANARIES].sort()).toEqual([...ALL_CANARIES].sort());
    for (const c of PROMPT_CANARIES) {
      expect(hasCanary(`что-то ${c.toUpperCase()} дальше`, PROMPT_CANARIES)).toBe(true);
      expect(checkOutputText(`Закат ${c} вариант`, { level: "medium" })).toBe("prompt_leak");
    }
  });

  it("метка не лежит в текстах версий: ни v1, ни v2", () => {
    const sources = [...allWriteSystemPrompts(), ...allAnalyzeSystemPrompts()];
    for (const text of sources) for (const c of ALL_CANARIES) expect(text).not.toContain(c);
  });

  it("реестр версий покрывает активные промпты: утечку активной версии поймают слой 4 и CI", () => {
    const write = allWriteSystemPrompts();
    const analyze = allAnalyzeSystemPrompts();
    expect(write).toContain(active.JUDGE_SYSTEM);
    expect(write).toContain(active.MODERATOR_SYSTEM);
    for (const level of ["rare", "medium", "well_done"] as const) {
      for (const mode of ["self", "friend"] as const) {
        expect(write).toContain(active.buildWriterSystem(level, mode));
      }
    }
    expect(analyze).toContain(active.ANALYZE_SYSTEM);
    // v1 остаётся в реестре: он может лежать в старых трассах и нужен для отката.
    expect(write).toContain(JUDGE_SYSTEM);
    expect(analyze.length).toBeGreaterThanOrEqual(2);
  });

  it("withCanary: текст промпта нетронут, метка своей роли в конце, чужих меток нет", () => {
    const out = withCanary(JUDGE_SYSTEM, "judge");
    expect(out.startsWith(JUDGE_SYSTEM)).toBe(true);
    expect(out).toContain(CANARIES.judge);
    expect(out).not.toContain(CANARIES.writer);
    expect(out).not.toContain(CANARIES.moderator);
    expect(out).not.toContain(CANARIES.analyze);
  });
});

describe("метка уходит в модель на каждом реальном вызове", () => {
  it("писатель, судья и модератор: системный промпт с меткой своей роли", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    generateText.mockResolvedValue({ output: { hooks: [] }, finishReason: "stop" });
    const { createAnthropicJudge, createAnthropicModerator, createAnthropicWriter } =
      await import("../roast/write/llm");
    const cases = [
      [createAnthropicWriter(), CANARIES.writer],
      [createAnthropicJudge(), CANARIES.judge],
      [createAnthropicModerator(), CANARIES.moderator],
    ] as const;
    for (const [generate, canary] of cases) {
      generateText.mockClear();
      await generate({ system: "СИСТЕМА", user: "ПОЛЬЗОВАТЕЛЬ" });
      const call = generateText.mock.calls[0]?.[0] as { system: string };
      expect(call.system.startsWith("СИСТЕМА")).toBe(true);
      expect(call.system).toContain(canary);
      expect(Object.values(CANARIES).filter((c) => call.system.includes(c))).toEqual([canary]);
    }
  });

  it("анализ: системный промпт с меткой analyze", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    generateText.mockResolvedValue({ output: {} });
    const { createAnthropicGenerate } = await import("../analyze/llm");
    await createAnthropicGenerate()({ system: "СИСТЕМА", parts: [{ type: "text", text: "x" }] });
    const call = generateText.mock.calls[0]?.[0] as { system: string };
    expect(call.system).toContain(CANARIES.analyze);
  });
});

describe("проверка бандла (scripts/ci/bundle-leaks)", () => {
  const needles = collectNeedles(ALL_CANARIES, [
    ...allWriteSystemPrompts(),
    ...allAnalyzeSystemPrompts(),
  ]);

  it("образцы берутся и из v2: строка текста, которой нет в v1, есть среди фраз", () => {
    const line = active.JUDGE_SYSTEM.split("\n").find(
      (l) => l.length > 40 && !JUDGE_SYSTEM.includes(l) && !/["'`\$]/.test(l.trim().slice(0, 40)),
    );
    expect(line).toBeDefined();
    const phrase = line!.trim().slice(0, 40);
    expect(needles.some((n) => n.kind === "phrase" && n.value === phrase)).toBe(true);
  });

  it("образцы: все canary и много фраз промптов, без кавычек и подстановок", () => {
    expect(needles.filter((n) => n.kind === "canary")).toHaveLength(ALL_CANARIES.length);
    const phrases = needles.filter((n) => n.kind === "phrase");
    expect(phrases.length).toBeGreaterThan(20);
    for (const p of phrases) expect(p.value).not.toMatch(/["'`\\$]/);
  });

  it("находит canary в любом регистре и фразу промпта, в том числе в виде \\uXXXX", () => {
    const phrase = needles.find((n) => n.kind === "phrase")!.value;
    const escaped = [...phrase]
      .map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join("");
    const leaks = findLeaks(
      [
        { path: "a.js", content: `var x="${CANARIES.writer.toUpperCase()}";` },
        { path: "b.js", content: `var y="${phrase}";` },
        { path: "c.js", content: `var z="${escaped}";` },
        { path: "d.js", content: "var ok='обычный клиентский код';" },
      ],
      needles,
    );
    expect(leaks.filter((l) => l.file === "a.js")[0]?.needle.kind).toBe("canary");
    expect(leaks.some((l) => l.file === "b.js")).toBe(true);
    expect(leaks.some((l) => l.file === "c.js")).toBe(true);
    expect(leaks.some((l) => l.file === "d.js")).toBe(false);
  });

  it("чистый бандл не даёт находок", () => {
    expect(findLeaks([{ path: "x.js", content: "console.log('Привет, мир')" }], needles)).toEqual(
      [],
    );
  });

  it("decodeUnicodeEscapes разбирает регистр шестнадцатеричных цифр", () => {
    expect(decodeUnicodeEscapes("\\u0414\\u043e")).toBe("До");
  });
});
