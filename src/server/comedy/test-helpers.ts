import { vi } from "vitest";
import { buildProfileFacts } from "../facts";
import { richRu } from "../facts/fixtures";
import type {
  ComedyDeps,
  ComedyGenerateFn,
  ComedyInput,
  ComedyMaterial,
  ComedyPrompt,
} from "./types";

// Фейки моделей comedy-движка: читают id из пользовательского сообщения, как настоящая модель.

/** Весь текст пользовательского сообщения (картинки пропущены). */
export function userText(p: ComedyPrompt): string {
  return p.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

export function makeMaterial(over: Partial<ComedyMaterial> = {}): ComedyMaterial {
  return {
    source: "agent-reach",
    username: "kirill.fit",
    displayName: "Кирилл",
    biography: "Тренер. Марафон минус 10 кг за 30 дней",
    counters: { posts: 120, followers: 5400, following: 300 },
    externalUrl: "taplink.cc",
    posts: [0, 1, 2].map((index) => ({
      index,
      takenAt: "2026-09-0" + (index + 1) + "T10:00:00.000Z",
      type: "photo",
      caption: `Дисциплина важнее мотивации, день ${index + 1}`,
      hashtags: ["марафон"],
      location: "Спортзал Олимп",
      likes: 100 + index,
      comments: 5,
    })),
    facts: { postsAnalyzed: 3 },
    images: [
      { label: "avatar", data: new Uint8Array([0xff, 0xd8, 0xff, 1]), mediaType: "image/jpeg" },
      { label: "post:0", data: new Uint8Array([0xff, 0xd8, 0xff, 2]), mediaType: "image/jpeg" },
    ],
    extraFacts: [],
    ...over,
  };
}

export function profileAnswer(over: Record<string, unknown> = {}, factCount = 12) {
  return {
    person: { callName: "Кирилл", gender: "male", ageStated: null },
    facts: Array.from({ length: factCount }, (_, i) => ({
      section: i % 2 === 0 ? "appearance" : "work_money",
      text: `Факт номер ${i + 1}: шейкер в кадре`,
      source: `post:${i % 3}`,
      basis: "seen",
    })),
    quotes: [{ text: "Дисциплина важнее мотивации", source: "post:0", about: "дисциплина" }],
    audience: [],
    unknowns: ["возраст"],
    coverage: {
      appearance: 80,
      work: 70,
      lifestyle: 50,
      selfImage: 60,
      quotes: 40,
      contradictions: 30,
      awkward: 20,
      biography: 10,
    },
    keyObservation: "Продаёт дисциплину через зеркало спортзала",
    ownHumor: null,
    closedTopics: [],
    minorSignals: false,
    ...over,
  };
}

export const fakeProfile = (answer: unknown = profileAnswer()) =>
  vi.fn<ComedyGenerateFn>(async () => answer);

/** Инсайты: категорию берёт из задания, опора на факты F1…F12 (связки разные). */
export function fakeInsights(count = 6) {
  return vi.fn<ComedyGenerateFn>(async (p) => {
    const cat = /категории ([ABC])/.exec(userText(p))?.[1] ?? "A";
    const shift = { A: 0, B: 4, C: 8 }[cat] ?? 0;
    return {
      insights: Array.from({ length: count }, (_, i) => ({
        title: `Инсайт ${cat}${i + 1}`,
        factIds: [`F${((shift + i) % 12) + 1}`, i === 0 ? "Q1" : `F${((shift + i + 1) % 12) + 1}`],
        insight: `Сталкиваем факты ${cat} ${i}`,
        directions: ["паспорт"],
        potential: 5 - (i % 5),
        risk: null,
      })),
    };
  });
}

/** Отбор: все инсайты из блока в порядке входа. */
export function fakeSelect() {
  return vi.fn<ComedyGenerateFn>(async (p) => {
    const ids = [...userText(p).matchAll(/^\[([ABC]\d+)\] категория/gm)].map((m) => m[1]!);
    return {
      picks: ids
        .slice(0, 15)
        .map((id, i) => ({ id, theme: `тема ${i}`, mechanic: "гипербола", score: 9 })),
    };
  });
}

const RU = ["Шейкер", "Зеркало", "Марафон", "Усы", "Ковролин", "Протеин"];

/** Генератор: по 3 разные русские шутки на каждый инсайт из блока `<insights>`. */
export function fakePunch(textFor?: (insightId: string, n: number, call: number) => string) {
  let call = 0;
  return vi.fn<ComedyGenerateFn>(async (p) => {
    call++;
    const block = /<insights>([\s\S]*?)<\/insights>/.exec(userText(p))?.[1] ?? "";
    const ids = [...block.matchAll(/^\[([ABC]\d+)\] /gm)].map((m) => m[1]!);
    return {
      punches: ids.flatMap((insightId) =>
        [1, 2, 3].map((n) => ({
          insightId,
          structure: n === 1 ? "false_compliment" : n === 2 ? "analogy" : "quote_twist",
          emoji: "🔥",
          text:
            textFor?.(insightId, n, call) ??
            `${RU[n]} номер ${insightId} вызов ${call} вариант ${n}, блядь`,
        })),
      ),
    };
  });
}

type ScoreOver = Partial<Record<string, number | boolean | string | null>>;

/** Редактор: всем по 4, `picked` — первые N по порядку входа (или `pick`). */
export function fakeEditor(
  perId: (id: string, text: string) => ScoreOver = () => ({}),
  pick?: (ids: string[], n: number) => string[],
) {
  return vi.fn<ComedyGenerateFn>(async (p) => {
    const text = userText(p);
    const n = Number(/N = (\d+)/.exec(text)?.[1] ?? "10");
    const rows = [...text.matchAll(/^\[(c\d+)\] \(инсайт [^)]*\) (.*)$/gm)];
    const ids = rows.map((m) => m[1]!);
    return {
      scores: rows.map((m) => ({
        id: m[1]!,
        surprise: 4,
        specificity: 4,
        punch: 4,
        rhythm: 4,
        clarity: 4,
        duplicateOf: null,
        broken: false,
        ...perId(m[1]!, m[2]!),
      })),
      picked: pick ? pick(ids, n) : ids.slice(0, n),
    };
  });
}

/** Модератор: всем «можно» (или по `perId`). */
export function fakeModerator(
  perId: (id: string, text: string) => Partial<Record<string, boolean>> = () => ({}),
) {
  return vi.fn<ComedyGenerateFn>(async (p) => {
    const rows = [...userText(p).matchAll(/^\[(m\d+)\] (.*)$/gm)];
    return {
      verdicts: rows.map((m) => ({
        id: m[1]!,
        hitsClosedTopic: false,
        selfContained: true,
        ...perId(m[1]!, m[2]!),
      })),
    };
  });
}

export function makeComedyDeps(over: Partial<ComedyDeps> = {}): ComedyDeps {
  let n = 0;
  let t = 0;
  return {
    profile: fakeProfile(),
    insights: fakeInsights(),
    select: fakeSelect(),
    punch: fakePunch(),
    editor: fakeEditor(),
    moderator: fakeModerator(),
    fetchCovers: vi.fn(async () => []),
    models: {
      profile: "test-profile",
      insights: "test-insights",
      select: "test-select",
      punch: "test-punch",
      editor: "test-editor",
      moderator: "test-moderator",
    },
    newId: () => `p_${String(++n).padStart(4, "0")}`,
    now: () => (t += 5),
    ...over,
  };
}

export const comedyInput = (over: Partial<ComedyInput> = {}): ComedyInput => ({
  source: { kind: "material", material: makeMaterial() },
  forbidden: [],
  extraFacts: [],
  mode: "self",
  level: "well_done",
  tier: 1,
  ...over,
});

export const snapshotSource = (): ComedyInput["source"] => {
  const snapshot = richRu();
  return { kind: "snapshot", snapshot, facts: buildProfileFacts(snapshot) };
};
