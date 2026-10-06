import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Level } from "@/contracts";
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

// Пересмотр красных линий (задача 14а, roast/v2) сквозь шаг `write` на моках: шутки на открытые
// темы доходят до выдачи на всех степенях, закрытые вычёркиваются слоем 4 до судьи.

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const OPEN = [
  "Спортзал в каждой сторис, зал в курсе",
  "Траты на кофе выросли вместе со стаканчиками",
  "Муж снимает закат лучше, чем ты",
  "Весишь меньше, чем твой штатив",
];
const CLOSED = [
  "После развода снимаешь только закаты",
  "Онкология не повод пропускать закат",
  "Дочка выбирает фильтр лучше тебя",
];

const levels: Level[] = ["rare", "medium", "well_done"];

describe.each(levels)("write на степени %s", (level) => {
  it("открытые темы проходят слой 4 и доходят до выдачи, закрытые вычёркиваются", async () => {
    // Для каждого крючка: два открытых варианта и один закрытый, с id крючка, чтобы не слиплись дубли.
    const writer = fakeWriter((hookId, n) => {
      if (n === 3) return `${CLOSED[Number(hookId.replace(/\D/g, "")) % CLOSED.length]} ${hookId}`;
      return `${OPEN[(Number(hookId.replace(/\D/g, "")) + n) % OPEN.length]} ${hookId}`;
    });
    const judge = fakeJudge();
    const moderator = fakeModerator();
    const r = await writeCandidates(
      inputBase({ tier: 2, level, persona: makePersona({}, 14) }),
      makeWriteDeps({ writer, judge, moderator }),
    );
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(CLOSED.some((t) => c.text.startsWith(t))).toBe(false);
      expect(OPEN.some((t) => c.text.startsWith(t))).toBe(true);
    }
    const l4 = r.stats.filters.layer4;
    // Открытых тем (деньги, семья, вес) в лексиконе больше нет: кодов topic_* для них не бывает.
    expect(Object.keys(l4).filter((k) => /^topic_(money|family|weight)$/.test(k))).toEqual([]);
    expect(l4.topic_appearance).toBeUndefined();
    // Закрытые режутся на любой степени.
    expect(l4.topic_sensitive).toBeGreaterThan(0);
    expect(l4.topic_health).toBeGreaterThan(0);
    expect(l4.topic_children).toBeGreaterThan(0);
    // Судья и модератор не видят вычеркнутого.
    for (const call of [...judge.mock.calls, ...moderator.mock.calls]) {
      const user = (call[0] as PromptText).user;
      for (const t of CLOSED) expect(user).not.toContain(t);
    }
  });

  it("в промптах активные версии v2: писатель, судья, модератор", async () => {
    const writer = fakeWriter();
    const judge = fakeJudge();
    const moderator = fakeModerator();
    const r = await writeCandidates(
      inputBase({ tier: 1, level }),
      makeWriteDeps({ writer, judge, moderator }),
    );
    expect(r.promptVersion).toBe("roast/v2");
    expect(r.moderator.promptVersion).toBe("roast/moderator-v2");
    expect((writer.mock.calls[0]![0] as PromptText).system).toMatch(/ОТКРЫТО на любой степени/);
    expect((judge.mock.calls[0]![0] as PromptText).system).toMatch(/спорт и тренировки/);
    expect((moderator.mock.calls[0]![0] as PromptText).system).toMatch(/Спорт, кофе, диеты/);
  });
});

describe("модератор на моках: то, что слой 4 не видит, режет слой 5", () => {
  it("hitsForbiddenTopic вычёркивает, открытые темы остаются", async () => {
    const moderator = fakeModerator((_id, text) => ({
      hitsForbiddenTopic: /мир иной/i.test(text),
    }));
    const writer = fakeWriter((hookId, n) =>
      n === 1 ? `Закат ушёл в мир иной, ${hookId}` : `${OPEN[n]} ${hookId}`,
    );
    const r = await writeCandidates(
      inputBase({ tier: 1, level: "medium", persona: makePersona({}, 12) }),
      makeWriteDeps({ writer, moderator }),
    );
    expect(r.candidates.some((c) => /мир иной/.test(c.text))).toBe(false);
    expect(r.candidates.some((c) => /Траты|Муж/.test(c.text))).toBe(true);
  });
});
