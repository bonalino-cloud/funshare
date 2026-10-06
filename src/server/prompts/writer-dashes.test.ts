import { describe, expect, it } from "vitest";
import { buildProfileFacts } from "../facts";
import { richRu } from "../facts/fixtures";
import type { HookStyle } from "../roast/write/types";
import { makePersona } from "../roast/write/test-helpers";
import { buildWriterPrompt, buildWriterSystem, normalizeDashes } from "./roast/v2";

const DASH = /[–—―]/;
const DASH_NOT_RANGE = /(?<!\d)[–—―]|[–—―](?!\d)/;

describe("писатель v2: длинное тире не доходит до модели", () => {
  it("normalizeDashes: до и после", () => {
    const cases: [string, string][] = [
      ["Три кофе — и ни одного дедлайна", "Три кофе, и ни одного дедлайна"],
      ["Ты не бегаешь — ты убегаешь от дивана", "Ты не бегаешь, ты убегаешь от дивана"],
      ["— Опять спортзал? — Опять.", "Опять спортзал? Опять."],
      ["Тренировки 5–10 раз в неделю — подвиг", "Тренировки 5–10 раз в неделю, подвиг"],
      ["Рассвет—закат—репит", "Рассвет, закат, репит"],
      ["Конец. — Новая мысль", "Конец. Новая мысль"],
      // Без строк-заглушек: «@@» из подписи остаётся как есть.
      ["Пиши @@admin — ответит", "Пиши @@admin, ответит"],
      ["Цены 5—6 тысяч", "Цены 5–6 тысяч"],
      ["Кофе -- и в зал", "Кофе, и в зал"],
      ['{"a":"—Привет","b":"кофе — зал"}', '{"a":"Привет","b":"кофе, зал"}'],
      ['сказал "кофе" — и ушёл', 'сказал "кофе", и ушёл'],
      ["сайт кофейня.xn--p1ai и всё", "сайт кофейня.xn--p1ai и всё"],
    ];
    for (const [from, to] of cases) expect(normalizeDashes(from)).toBe(to);
  });

  it("системный промпт писателя: без тире на всех степенях и режимах", () => {
    for (const level of ["rare", "medium", "well_done"] as const) {
      for (const mode of ["self", "friend"] as const) {
        expect(buildWriterSystem(level, mode)).not.toMatch(DASH);
      }
    }
    expect(buildWriterSystem("medium", "self")).toMatch(/точку, двоеточие или запятую/);
  });

  it("собранный промпт с образцами банка, досье и фактами: без тире вне диапазонов цифр", () => {
    const dirty =
      "Он берёт кофе — и фотографирует — чаще, чем пьёт. Это 3–4 раза в день ― а то и 5—6.";
    const persona = makePersona({
      summary: "Кофеман — и спортсмен",
      vibe: "тёплый – ироничный",
      humorAngles: ["траты — на кроссовки"],
    });
    const card = (ref: string, text: string | null, skeleton: string) => ({
      ref,
      cardId: ref,
      mechanism: "hyperbole" as const,
      skeleton,
      text,
    });
    const style: HookStyle = {
      hook: {
        id: "o1",
        claim: "Кофе — каждый день",
        evidence: ["post:0"],
        recognizability: 4,
        kind: "habit",
        hasNumber: false,
      },
      skeletons: [card("s1", null, "Ход — потом поворот")],
      examples: [card("e1", dirty, "скелет")],
    };
    const { system, user } = buildWriterPrompt({
      persona,
      facts: buildProfileFacts(richRu()),
      extraFacts: ["Любит марафоны — бегает по утрам"],
      styles: [style],
      level: "medium",
      mode: "self",
      alreadyWritten: ["Шутка — повтор"],
    });
    expect(system).not.toMatch(DASH);
    expect(user).not.toMatch(DASH_NOT_RANGE);
    expect(user).toContain("3–4 раза в день");
    expect(user).toContain("Кофе, каждый день");
  });
});
