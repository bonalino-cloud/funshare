import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmSchemaError } from "../../analyze/llm";
import { MODERATOR_PROMPT_VERSION } from "../../prompts/active";
import { WriteFailedError } from "./types";
import type { PromptText } from "./llm";
import { writeCandidates } from "./write-candidates";
import {
  fakeJudge,
  fakeModerator,
  fakeWriter,
  inputBase,
  makePersona,
  makeWriteDeps,
} from "./test-helpers";

let errors: string[];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    errors.push(String(line));
  });
});
afterEach(() => vi.restoreAllMocks());

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof WriteFailedError ? e.reason : "other";
  }
  return "none";
};

const rows = (p: PromptText) => [...p.user.matchAll(/^\[(m\d+)\] (.*)$/gm)];

describe("слой 5: LLM-модератор", () => {
  it("вычеркнутых заменяют следующие по рейтингу судьи, итог добран до потолка тарифа", async () => {
    const rejected = new Set<string>();
    let call = 0;
    const spy = vi.fn(async (p: PromptText) => {
      call++;
      const first = call === 1;
      return fakeModerator((id, text) => {
        if (!first || !["m1", "m2", "m3"].includes(id)) return {};
        rejected.add(text);
        return { hitsForbiddenTopic: true };
      })(p);
    });
    // Судья ранжирует: c1.. выше. Первый проход берёт 10 лучших, три вычёркнуты, второй добирает 3.
    const r = await writeCandidates(
      inputBase({ tier: 1, level: "medium", persona: makePersona({}, 10) }),
      makeWriteDeps({ moderator: spy }),
    );
    expect(r.candidates).toHaveLength(10);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(r.stats.droppedByModerator).toBe(3);
    expect(r.stats.filters.layer5).toEqual({ forbidden_topic: 3 });
    expect(r.stats.filters.moderatorPasses).toBe(2);
    expect(r.stats.filters.moderatorChecked).toBe(13);
    for (const c of r.candidates) expect(rejected.has(c.text)).toBe(false);
    // Вычеркнутых не переписывают: каждый показанный текст один из написанных.
    expect(errors.some((l) => l.includes("модератор_вырезал=3"))).toBe(true);
  });

  it("каждый из четырёх вопросов вычёркивает со своим кодом", async () => {
    const verdicts: Record<string, Record<string, boolean>> = {
      m1: { aboutBehavior: false },
      m2: { friendSafe: false },
      m3: { selfContained: false },
      m4: { hitsForbiddenTopic: true },
    };
    let call = 0;
    const moderator = vi.fn(async (p: PromptText) => {
      call++;
      return fakeModerator((id) => (call === 1 ? (verdicts[id] ?? {}) : {}))(p);
    });
    const r = await writeCandidates(
      inputBase({ tier: 1, mode: "friend" }),
      makeWriteDeps({ moderator }),
    );
    expect(r.stats.filters.layer5).toEqual({
      not_behavior: 1,
      not_friend_safe: 1,
      unclear: 1,
      forbidden_topic: 1,
    });
    expect(r.stats.droppedByModerator).toBe(4);
  });

  it("нет вердикта на кандидата: он отпадает, непроверенное не показываем", async () => {
    const inner = fakeModerator();
    const moderator = vi.fn(async (p: PromptText) => {
      const out = (await inner(p)) as { verdicts: { id: string }[] };
      return { verdicts: out.verdicts.filter((v) => v.id !== "m2") };
    });
    const r = await writeCandidates(inputBase({ tier: 1 }), makeWriteDeps({ moderator }));
    expect(r.stats.unmoderated).toBeGreaterThanOrEqual(1);
    expect(r.stats.filters.layer5.no_verdict).toBe(r.stats.unmoderated);
    expect(r.candidates.length).toBeGreaterThanOrEqual(6);
  });

  it("битый вердикт не принимается: ретрай, потом успех", async () => {
    const inner = fakeModerator();
    let calls = 0;
    const moderator = vi.fn(async (p: PromptText) => {
      calls++;
      if (calls === 1) return { verdicts: [{ id: "m1", aboutBehavior: "да" }] };
      return inner(p);
    });
    const r = await writeCandidates(inputBase({ tier: 1 }), makeWriteDeps({ moderator }));
    expect(r.candidates.length).toBeGreaterThanOrEqual(6);
    expect(moderator).toHaveBeenCalledTimes(2);
    expect((moderator.mock.calls[1]![0] as PromptText).user).toContain(
      "Предыдущий ответ не принят",
    );
  });

  it("модератор упал на всех пачках: llm_failed, а не тихий пропуск", async () => {
    const moderator = vi.fn(async () => {
      throw new LlmSchemaError("обрезан");
    });
    expect(
      await reason(writeCandidates(inputBase({ tier: 1 }), makeWriteDeps({ moderator }))),
    ).toBe("llm_failed");
    expect(moderator).toHaveBeenCalledTimes(3);
  });

  it("упала одна пачка из двух: её кандидаты отпали без вердикта, шаг жив", async () => {
    const inner = fakeModerator();
    const moderator = vi.fn(async (p: PromptText) => {
      if (/^\[m13\] /m.test(p.user)) throw new LlmSchemaError("обрезан");
      return inner(p);
    });
    const r = await writeCandidates(
      inputBase({ tier: 2, level: "well_done", persona: makePersona({}, 14) }),
      makeWriteDeps({ moderator }),
    );
    expect(r.stats.unmoderated).toBe(8);
    expect(r.candidates.length).toBeGreaterThanOrEqual(8);
  });

  it("модератор лёг на проходе замены: одобренные не теряются, шаг жив при минимуме", async () => {
    let call = 0;
    const moderator = vi.fn(async (p: PromptText) => {
      call++;
      if (call > 1) throw new LlmSchemaError("обрезан");
      return fakeModerator((id) => (id === "m1" ? { friendSafe: false } : {}))(p);
    });
    const r = await writeCandidates(
      inputBase({ tier: 1, level: "medium", persona: makePersona({}, 10) }),
      makeWriteDeps({ moderator }),
    );
    expect(r.candidates).toHaveLength(9);
    expect(r.stats.filters.layer5).toEqual({ not_friend_safe: 1, no_verdict: 1 });
    expect(r.stats.unmoderated).toBe(1);
  });

  it("пачки: не больше 12 кандидатов на вызов", async () => {
    const moderator = fakeModerator();
    await writeCandidates(
      inputBase({ tier: 2, level: "well_done", persona: makePersona({}, 14) }),
      makeWriteDeps({ moderator }),
    );
    const sizes = moderator.mock.calls.map((c) => rows(c[0] as PromptText).length);
    expect(sizes).toEqual([12, 8]);
  });

  it("модератор не видит досье и крючки: только запретные темы и тексты шуток", async () => {
    const moderator = fakeModerator();
    await writeCandidates(
      inputBase({ tier: 1, persona: makePersona({ avoidTopics: ["деньги", "Артём"] }) }),
      makeWriteDeps({ moderator }),
    );
    const prompt = moderator.mock.calls[0]![0] as PromptText;
    expect(prompt.user).toContain("<forbidden_topics>");
    expect(prompt.user).toContain("- Артём");
    expect(prompt.user).not.toContain("Путешественница");
    expect(prompt.user).not.toContain("Наблюдение номер");
  });

  it("вердикт про отброшенные всё: not_enough_candidates, проходов не больше лимита", async () => {
    const moderator = fakeModerator(() => ({ aboutBehavior: false }));
    expect(
      await reason(writeCandidates(inputBase({ tier: 1 }), makeWriteDeps({ moderator }))),
    ).toBe("not_enough_candidates");
    // 2 раунда писателя × не больше 3 проходов; пачек в проходе по 1–2.
    expect(moderator.mock.calls.length).toBeLessThanOrEqual(2 * 3 * 2);
  });

  it("перенесённые из Поджога не модерируются повторно", async () => {
    const moderator = fakeModerator();
    const carried = [
      {
        id: "p_old",
        emoji: "🔥",
        text: "Перенесённая шутка про закат",
        trace: {
          hookId: "o1",
          mechanism: "hyperbole" as const,
          evidenceRef: "post:0",
          jokeCardId: null,
          scores: null,
          totalScore: null,
          tastePack: "taste/v1",
          promptVersion: "roast/v1",
          writerModel: "w",
          judgeModel: "j",
        },
      },
    ];
    await writeCandidates(inputBase({ tier: 2, carried }), makeWriteDeps({ moderator }));
    for (const c of moderator.mock.calls) {
      expect((c[0] as PromptText).user).not.toContain("Перенесённая шутка про закат");
    }
  });

  it("результат: версия промпта и модель модератора для трассы", async () => {
    const r = await writeCandidates(inputBase({ tier: 1 }), makeWriteDeps());
    expect(r.moderator).toEqual({
      promptVersion: MODERATOR_PROMPT_VERSION,
      model: "test-moderator",
    });
  });
});

describe("слой 4 в шаге write", () => {
  it("мат на medium вычёркивается до судьи: судья не платит за брак", async () => {
    const writer = fakeWriter((hookId, n) =>
      n === 1 ? `Закат ${hookId}, блядь, снова` : `Закат ${hookId} вариант ${n}`,
    );
    const judge = fakeJudge();
    const r = await writeCandidates(
      inputBase({ tier: 2, persona: makePersona({}, 14) }),
      makeWriteDeps({ writer, judge }),
    );
    expect(r.stats.filters.layer4.profanity).toBeGreaterThan(0);
    expect(r.stats.droppedInvalid).toBeGreaterThanOrEqual(r.stats.filters.layer4.profanity ?? 0);
    for (const call of judge.mock.calls) {
      expect((call[0] as PromptText).user).not.toContain("блядь");
    }
    expect(r.candidates.some((c) => c.text.includes("блядь"))).toBe(false);
  });

  it("на well_done мат допустим, а запретные темы нет", async () => {
    const writer = fakeWriter((hookId, n) =>
      n === 1
        ? `Закат ${hookId}, блядь, снова`
        : n === 2
          ? `Закат ${hookId} и церковь рядом`
          : `Закат ${hookId} вариант ${n}`,
    );
    const r = await writeCandidates(
      inputBase({ tier: 2, level: "well_done", persona: makePersona({}, 14) }),
      makeWriteDeps({ writer }),
    );
    expect(r.stats.filters.layer4.profanity).toBeUndefined();
    expect(r.stats.filters.layer4.topic_religion).toBeGreaterThan(0);
    expect(r.candidates.some((c) => c.text.includes("блядь"))).toBe(true);
    expect(r.candidates.some((c) => c.text.includes("церковь"))).toBe(false);
  });

  it("утечка: canary в тексте шутки вычёркивает её", async () => {
    const writer = fakeWriter((hookId, n) =>
      n === 1 ? `Закат ${hookId} CNRY-ABC123 вариант` : `Закат ${hookId} вариант ${n}`,
    );
    const r = await writeCandidates(
      inputBase({ tier: 2, persona: makePersona({}, 14) }),
      makeWriteDeps({ writer, canaries: ["cnry-abc123"] }),
    );
    expect(r.stats.filters.layer4.prompt_leak).toBeGreaterThan(0);
    expect(r.candidates.some((c) => /CNRY/i.test(c.text))).toBe(false);
  });

  it("форма, язык, длина и дубли считаются по кодам тем же счётчиком", async () => {
    const writer = fakeWriter((hookId, n) =>
      n === 1 ? "English only joke here" : n === 2 ? "я".repeat(150) : `Закат ${hookId}`,
    );
    const r = await writeCandidates(
      inputBase({ tier: 2, persona: makePersona({}, 14) }),
      makeWriteDeps({ writer }),
    );
    expect(r.stats.filters.layer4.not_russian).toBeGreaterThan(0);
    expect(r.stats.filters.layer4.too_long).toBeGreaterThan(0);
  });

  it("лог одной строкой: только коды и числа, без текстов шуток", async () => {
    const writer = fakeWriter((hookId, n) =>
      n === 1 ? `Секретная шутка ${hookId}, блядь` : `Закат ${hookId} вариант ${n}`,
    );
    await writeCandidates(
      inputBase({ tier: 2, persona: makePersona({}, 14) }),
      makeWriteDeps({ writer }),
    );
    const lines = errors.filter((l) => l.startsWith("[write] раундов="));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/l4=\S*profanity:\d+/);
    expect(lines[0]).toContain("l5=");
    expect(lines[0]).not.toContain("Секретная");
    expect(lines[0]).not.toContain("Закат");
  });
});
