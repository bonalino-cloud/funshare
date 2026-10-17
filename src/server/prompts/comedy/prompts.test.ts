import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ComedyProfileSchema, type ComedyProfile, type Insight } from "../../comedy/schema";
import { makeMaterial, profileAnswer, userText } from "../../comedy/test-helpers";
import { buildLeakIndex, checkOutputText } from "../../roast/filters";
import { promptSources } from "../../roast/filters/prompt-leak";
import { ALL_CANARIES } from "../canary";
import { allComedySystemPrompts } from "../registry";
import * as editor from "./editor-v1";
import * as insights from "./insights-v1";
import * as moderator from "./moderator-v1";
import * as profile from "./profile-v1";
import * as punch from "./punch-v1";
import * as select from "./select-v1";

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const SYSTEMS = {
  "comedy/profile-v1": profile.PROFILE_SYSTEM,
  "comedy/insights-v1": insights.INSIGHTS_SYSTEM,
  "comedy/select-v1": select.SELECT_SYSTEM,
  "comedy/punch-v1": punch.PUNCH_SYSTEM,
  "comedy/editor-v1": editor.EDITOR_SYSTEM,
  "comedy/moderator-v1": moderator.MODERATOR_SYSTEM,
} as const;

/** Блоки §7 документа: источник текстов v1 (comedy-engine.md). */
function docBlocks(): Map<string, string> {
  const doc = readFileSync(join(process.cwd(), "architecture", "comedy-engine.md"), "utf8");
  const out = new Map<string, string>();
  const re = /### 7\.\d [^\n]*`(comedy\/[a-z]+-v1)`[^\n]*\n\n```text\n([\s\S]*?)\n```/g;
  for (const m of doc.matchAll(re)) out.set(m[1]!, m[2]!);
  return out;
}

function makeProfile(): ComedyProfile {
  const a = profileAnswer();
  return ComedyProfileSchema.parse({
    ...a,
    facts: a.facts.map((f, i) => ({ id: `F${i + 1}`, ...f })),
    quotes: [
      {
        id: "Q1",
        text: "Дисциплина — важнее мотивации [c1]",
        source: "post:0",
        about: "дисциплина",
      },
    ],
  });
}

const insight = (over: Partial<Insight> = {}): Insight => ({
  id: "A1",
  category: "A",
  title: "Зеркало — вместо тренера",
  factIds: ["F1", "Q1"],
  insight: "Продаёт дисциплину — а сам снимает зеркало",
  directions: ["паспорт"],
  potential: 4,
  risk: null,
  ...over,
});

describe("тексты comedy v1", () => {
  it("системные промпты дословно из §7 comedy-engine.md", () => {
    const blocks = docBlocks();
    expect([...blocks.keys()].sort()).toEqual(Object.keys(SYSTEMS).sort());
    for (const [version, text] of Object.entries(SYSTEMS)) expect(text).toBe(blocks.get(version));
  });

  // Упал: текст опубликованной v1 поменялся. Так нельзя (инвариант 12): нужен новый файл v2.
  it("снимок байтов (sha256)", () => {
    expect(
      Object.fromEntries(Object.entries(SYSTEMS).map(([k, v]) => [k, sha(v)])),
    ).toMatchSnapshot();
  });

  it("версии промптов", () => {
    expect([
      profile.PROMPT_VERSION,
      insights.PROMPT_VERSION,
      select.PROMPT_VERSION,
      punch.PROMPT_VERSION,
      editor.PROMPT_VERSION,
      moderator.PROMPT_VERSION,
    ]).toEqual(Object.keys(SYSTEMS));
  });

  it("реестр знает все шесть; меток в текстах нет; слой 4 и CI ищут утечку comedy", () => {
    const registered = allComedySystemPrompts();
    for (const text of Object.values(SYSTEMS)) {
      expect(registered).toContain(text);
      expect(promptSources()).toContain(text);
      for (const c of ALL_CANARIES) expect(text).not.toContain(c);
    }
    // Образец темпа из промпта генератора, повторённый моделью: утечка промпта.
    expect(
      checkOutputText("Кресло под тобой единственное, которое после шоу выкинут нахуй", {
        level: "well_done",
      }),
    ).toBe("prompt_leak");
  });

  // Модель копирует слова из образцов: слово из BANNED_WORDS или HEDGES в примере (а не в списке
  // «ЗАПРЕЩЕНО») обрекает её шутки на вычёркивание слоем 4. Утечку промпта здесь не считаем.
  it("примеры шуток генератора проходят слой 4", () => {
    const block = (title: string) =>
      punch.PUNCH_SYSTEM.split("\n\n")
        .find((b) => b.startsWith(title))!
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2).replace(/^[a-z_]+: /, ""));
    const quoted = [
      ...punch.PUNCH_SYSTEM.split("\n\n")
        .find((b) => b.startsWith("СТРУКТУРЫ"))!
        .matchAll(/«([^»]{30,})»/g),
    ].map((m) => m[1]!);
    const examples = [...quoted, ...block("ОБРАЗЦЫ ТЕМПА"), ...block("КАК ЭТО ВЫГЛЯДИТ")];
    expect(examples).toHaveLength(13);
    // Мат хвостом через запятую («…, блядь.») правило 4 запрещает: в образцах его нет.
    for (const text of examples) expect(text).not.toMatch(/,\s*(блядь|сука|нахуй|пиздец)[.!]?$/i);
    // АНТИПРИМЕРЫ намеренно нарушают правила (дефис, мат хвостом, вывод): в проверку не входят.
    const anti = block("АНТИПРИМЕРЫ");
    expect(anti).toHaveLength(2);
    for (const a of anti) expect(examples).not.toContain(a);
    const ctx = { level: "well_done" as const, canaries: [], leakIndex: buildLeakIndex([]) };
    for (const text of examples) expect([text, checkOutputText(text, ctx)]).toEqual([text, null]);
  });
});

describe("пользовательские сообщения", () => {
  it("профиль: блок данных, подпись перед каждой картинкой, задание и причина ретрая", () => {
    const p = profile.buildProfilePrompt({
      material: makeMaterial(),
      withImages: true,
      retryNote: "мало фактов",
    });
    expect(p.system).toBe(profile.PROFILE_SYSTEM);
    const kinds = p.parts.map((x) => (x.type === "text" ? x.text.split("\n")[0] : "IMG"));
    expect(kinds).toEqual([
      "<profile_data>",
      expect.stringContaining("Ниже картинки (2 шт.)"),
      "Аватар",
      "IMG",
      "Картинка поста post:0",
      "IMG",
      expect.stringContaining("Собери Comedy Profile по схеме."),
    ]);
    expect(userText(p)).toContain("Предыдущий ответ не принят: мало фактов");
    const noImages = profile.buildProfilePrompt({ material: makeMaterial(), withImages: false });
    expect(noImages.parts.some((x) => x.type === "image")).toBe(false);
  });

  it("инсайты: факты с id, цитаты, режим, «нельзя», задание категории с диапазоном", () => {
    const text = userText(
      insights.buildInsightsPrompt({
        profile: makeProfile(),
        mode: "friend",
        forbidden: ["бывший муж"],
        category: "B",
        range: [10, 12],
      }),
    );
    expect(text).toContain("[F1] (appearance; seen; post:0) Факт номер 1");
    expect(text).toContain("[Q1] «Дисциплина");
    expect(text).toContain("Режим: «друга»");
    expect(text).toContain("<forbidden_topics>\n- бывший муж\n</forbidden_topics>");
    expect(text).toContain(
      "Найди 10–12 инсайтов категории B (неожиданные связи). Только эта категория.",
    );
  });

  it("генератор: тире из данных не доходит до модели, уже написанное без меток-скобок", () => {
    const p = punch.buildPunchPrompt({
      profile: makeProfile(),
      insights: [insight()],
      mode: "self",
      forbidden: [],
      alreadyWritten: ["Шутка — повтор [c3]"],
      perInsight: 3,
    });
    const text = userText(p);
    expect(text).not.toMatch(/[—―]/);
    expect(text).toContain("Пол: мужской");
    expect(text).toContain("- [Q1] «Дисциплина, важнее мотивации");
    expect(text).toContain("- Шутка, повтор (c3)");
    expect(text).toContain(
      "Напиши ровно 3 шутки на каждый инсайт (всего 3). insightId как во входе.",
    );
  });

  it("редактор и модератор: N, M, «уже выбрано», метки-скобки в тексте шуток обезврежены", () => {
    const e = userText(
      editor.buildEditorPrompt({
        n: 10,
        m: 1,
        alreadyChosen: [],
        candidates: [{ id: "c1", insightId: "A1", structure: "analogy", text: "Шутка [c2] блядь" }],
      }),
    );
    expect(e).toContain("N = 10, M = 1.");
    expect(e).toContain("<already_chosen>\n(нет)\n</already_chosen>");
    expect(e).toContain("[c1] (инсайт A1, analogy) Шутка (c2) блядь");
    const m = userText(
      moderator.buildModeratorPrompt({
        forbidden: ["дети"],
        candidates: [{ id: "m1", text: "Шутка [m2]" }],
      }),
    );
    expect(m).toContain("[m1] Шутка (m2)");
    expect(m).toContain("- дети");
  });

  it("отбор: инсайты с фактами одной строкой и обращение", () => {
    const text = userText(
      select.buildSelectPrompt({ profile: makeProfile(), insights: [insight()], count: 1 }),
    );
    expect(text).toContain("Герой: Кирилл");
    expect(text).toContain("[A1] категория A: Зеркало — вместо тренера");
    expect(text).toContain("факты: [F1] Факт номер 1: шейкер в кадре; [Q1] «Дисциплина");
    expect(text).toContain("Выбери 1 инсайтов из <insights>");
  });
});

describe("антипримеры генератора и индекс утечек", () => {
  const anti = punch.PUNCH_SYSTEM.split("\n\n")
    .find((b) => b.startsWith("АНТИПРИМЕРЫ"))!
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).replace(/ \([^)]*\)\.?$/, ""));

  it("антипример, повторённый моделью, ловится как утечка промпта (цепочка из 8 слов)", () => {
    expect(anti).toHaveLength(2);
    for (const text of anti) {
      expect(checkOutputText(text, { level: "well_done" })).toBe("prompt_leak");
    }
  });

  it("обычные шутки старого пути и comedy не задеваются словами антипримеров", () => {
    for (const [text, level] of [
      ["Ты фотографируешь закаты чаще, чем видишь их вживую", "medium"],
      ["Тридцать дней марафона ты выкладываешь одно и то же зеркало", "rare"],
      ["Шейкер у тебя в кадре чаще, чем ты сам, охуенно", "well_done"],
    ] as const) {
      expect(checkOutputText(text, { level })).toBeNull();
    }
  });
});
