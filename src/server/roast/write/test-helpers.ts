import { vi } from "vitest";
import type { PersonaProfile } from "@/contracts";
import { buildProfileFacts } from "../../facts";
import { richRu } from "../../facts/fixtures";
import type { RuntimeCard } from "../jokes/repository";
import type { BankCards } from "./bank";
import type { GenerateFn, PromptText } from "./llm";
import type { PunchTrace, WriteInput } from "./types";
import type { WriteDeps } from "./write-candidates";

export function makePersona(over: Partial<PersonaProfile> = {}, observations = 12): PersonaProfile {
  return {
    username: "anya",
    displayName: "Аня",
    language: "ru",
    summary: "Путешественница, снимает закаты и кофе.",
    vibe: "тёплая, самоироничная",
    traits: ["любопытная", "организованная", "сентиментальная"],
    interests: ["путешествия"],
    habits: ["закат в каждой подписи"],
    aesthetics: "тёплые тона",
    humorAngles: ["закаты"],
    avoidTopics: ["деньги"],
    look: null,
    observations: Array.from({ length: observations }, (_, i) => ({
      id: `o${i + 1}`,
      claim: `Наблюдение номер ${i + 1} про закаты`,
      evidence: [
        i % 3 === 0
          ? `fact:hashtag:закат=${i + 2}`
          : i % 3 === 1
            ? "fact:postsPerWeek:4"
            : `post:${i}`,
      ],
      recognizability: 5 - (i % 5),
      safe: true,
    })),
    warmFacts: ["Умеет смеяться над собой"],
    signatureMoves: ["закат в каждой подписи"],
    sensitiveEvents: [],
    flags: { isPrivate: false, likelyMinor: false, insufficientData: false },
    ...over,
  };
}

export function makeCard(over: Partial<RuntimeCard> = {}): RuntimeCard {
  return {
    id: "card-1",
    source: "s1#1",
    mechanism: "hyperbole",
    skeleton: "Преувеличь повтор до абсурда",
    slots: ["habit"],
    heat: "mild",
    topic: "behavior",
    score: 0,
    text: "Он фотографирует кофе чаще, чем пьёт.",
    ...over,
  };
}

export function makeBank(): BankCards {
  const mech = ["hyperbole", "reversal", "faux_compliment", "understatement"] as const;
  return {
    skeletons: mech.map((m, i) =>
      makeCard({ id: `sk${i}`, source: `s1#${i + 1}`, mechanism: m, text: null }),
    ),
    examples: [0, 1, 2, 3].map((i) =>
      makeCard({ id: `ex${i}`, source: `s2#${i + 1}`, text: `Образец ${i}` }),
    ),
  };
}

export const inputBase = (over: Partial<WriteInput> = {}): WriteInput => ({
  persona: makePersona(),
  facts: buildProfileFacts(richRu()),
  extraFacts: [],
  mode: "self",
  level: "medium",
  tier: 2,
  ...over,
});

export const makeTrace = (over: Partial<PunchTrace> = {}): PunchTrace => ({
  hookId: "o1",
  mechanism: "hyperbole",
  evidenceRef: "post:0",
  jokeCardId: null,
  scores: null,
  totalScore: null,
  promptVersion: "roast/v1",
  writerModel: "w",
  judgeModel: "j",
  ...over,
});

const RU = ["Закат", "Кофе", "Билет", "Рассвет", "Чемодан", "Сторис"];

/** Писатель-заглушка: по 3 разных русских шутки на каждый hookId из блока <hooks>. */
export function fakeWriter(textFor?: (hookId: string, n: number, call: number) => string) {
  let call = 0;
  return vi.fn<GenerateFn>(async (p: PromptText) => {
    call++;
    const block = /<hooks>([\s\S]*?)<\/hooks>/.exec(p.user)?.[1] ?? "";
    const ids = [...block.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]!);
    return {
      hooks: ids.map((hookId) => ({
        hookId,
        candidates: [1, 2, 3].map((n) => ({
          mechanism: "hyperbole",
          skeleton: "s1",
          emoji: "🌅",
          text: textFor?.(hookId, n, call) ?? `${RU[n]} номер ${hookId} раунд ${call} вариант ${n}`,
          evidenceRef: "post:0",
        })),
      })),
    };
  });
}

/** Судья-заглушка: всем одинаково `score` (или по id из `perId`). */
export function fakeJudge(
  score = 4,
  perId: (id: string, text: string) => Partial<Record<string, number>> = () => ({}),
) {
  return vi.fn<GenerateFn>(async (p: PromptText) => {
    const rows = [...p.user.matchAll(/^\[(c\d+)\] \(крючок [^)]*\) (.*)$/gm)];
    return {
      scores: rows.map((m) => ({
        id: m[1]!,
        recognizability: score,
        surprise: score,
        brevity: score,
        aboutBehavior: score,
        warmth: score,
        ...perId(m[1]!, m[2]!),
      })),
    };
  });
}

/**
 * Модератор-заглушка: всем «можно» (или по `perId`: `id`, текст → частичные поля вердикта).
 */
export function fakeModerator(
  perId: (id: string, text: string) => Partial<Record<string, boolean>> = () => ({}),
) {
  return vi.fn<GenerateFn>(async (p: PromptText) => {
    const rows = [...p.user.matchAll(/^\[(m\d+)\] (.*)$/gm)];
    return {
      verdicts: rows.map((m) => ({
        id: m[1]!,
        aboutBehavior: true,
        hitsForbiddenTopic: false,
        friendSafe: true,
        selfContained: true,
        ...perId(m[1]!, m[2]!),
      })),
    };
  });
}

export function makeWriteDeps(over: Partial<WriteDeps> = {}): WriteDeps {
  let n = 0;
  return {
    writer: fakeWriter(),
    judge: fakeJudge(),
    moderator: fakeModerator(),
    loadBank: async () => makeBank(),
    models: { writer: "test-writer", judge: "test-judge", moderator: "test-moderator" },
    newId: () => `p_${String(++n).padStart(4, "0")}`,
    ...over,
  };
}
