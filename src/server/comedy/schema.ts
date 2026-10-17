import { z } from "zod";
import { capCodepoints, cleanUntrusted, sanitizeText } from "../facts/text";
import { INSIGHT_CATEGORIES } from "./config";

// Схемы выходов comedy-движка (comedy-engine §3). Модели уходит строгая JSON Schema (`*Output`),
// но SDK ответ НЕ валидирует: каждый элемент проверяется кодом отдельно (`*Item`), кривой
// элемент выбрасывается, а не роняет пачку. Id фактов, цитат, инсайтов и кандидатов проставляет
// код. Тексты модели проходят `sanitizeText` (без управляющих символов, угловые скобки
// обезврежены): они идут в следующие промпты внутри тегов, и закрыть тег из них нельзя.

export const SECTIONS = [
  "basics",
  "appearance",
  "work_money",
  "lifestyle",
  "self_image",
  "habits",
  "contradictions",
  "awkward",
  "social",
] as const;
export const FACT_BASES = ["seen", "stated", "computed", "user_claim"] as const;
export const GENDERS = ["male", "female", "unknown"] as const;
export type Gender = (typeof GENDERS)[number];
export const STRUCTURES = [
  "false_compliment",
  "fact_fusion",
  "absurd_cause",
  "hybrid_image",
  "analogy",
  "quote_twist",
  "other",
] as const;
export type Structure = (typeof STRUCTURES)[number];

/** Потолки длины текстов (comedy-engine §3). */
export const CAPS = {
  callName: 40,
  ageStated: 40,
  factText: 140,
  source: 60,
  quoteText: 200,
  about: 60,
  audienceText: 160,
  unknown: 80,
  keyObservation: 300,
  ownHumor: 300,
  closedTopic: 80,
  insightTitle: 60,
  insight: 180,
  direction: 60,
  risk: 120,
  theme: 40,
  mechanic: 40,
  /** Id из ответа модели: длиннее id не бывает, чужое не храним. */
  id: 40,
} as const;

// ---------------------------------------------------------------------------
// Для модели: JSON Schema. Ограничения длины и числа провайдер переносит в описание поля.
// ---------------------------------------------------------------------------

const Percent = z.number().int().min(0).max(100);
const Score05 = z.number().int().min(0).max(5);

export const ProfileOutput = z.object({
  person: z.object({
    callName: z.string().max(CAPS.callName).nullable(),
    gender: z.enum(GENDERS),
    ageStated: z.string().max(CAPS.ageStated).nullable(),
  }),
  facts: z
    .array(
      z.object({
        section: z.enum(SECTIONS),
        text: z.string().max(CAPS.factText),
        source: z.string().max(CAPS.source),
        basis: z.enum(FACT_BASES),
      }),
    )
    .max(45),
  quotes: z
    .array(
      z.object({
        text: z.string().max(CAPS.quoteText),
        source: z.string().max(CAPS.source),
        about: z.string().max(CAPS.about),
      }),
    )
    .max(10),
  audience: z
    .array(
      z.object({ text: z.string().max(CAPS.audienceText), source: z.string().max(CAPS.source) }),
    )
    .max(6),
  unknowns: z.array(z.string().max(CAPS.unknown)).max(10),
  coverage: z.object({
    appearance: Percent,
    work: Percent,
    lifestyle: Percent,
    selfImage: Percent,
    quotes: Percent,
    contradictions: Percent,
    awkward: Percent,
    biography: Percent,
  }),
  keyObservation: z.string().max(CAPS.keyObservation),
  ownHumor: z.string().max(CAPS.ownHumor).nullable(),
  closedTopics: z.array(z.string().max(CAPS.closedTopic)).max(8),
  minorSignals: z.boolean(),
});

export const InsightsOutput = z.object({
  insights: z.array(
    z.object({
      title: z.string().max(CAPS.insightTitle),
      factIds: z.array(z.string()).min(1).max(4),
      insight: z.string().max(CAPS.insight),
      directions: z.array(z.string().max(CAPS.direction)).max(2),
      potential: z.number().int().min(1).max(5),
      risk: z.string().max(CAPS.risk).nullable(),
    }),
  ),
});

export const SelectOutput = z.object({
  picks: z
    .array(
      z.object({
        id: z.string(),
        theme: z.string().max(CAPS.theme),
        mechanic: z.string().max(CAPS.mechanic),
        score: z.number().int().min(1).max(10),
      }),
    )
    .max(15),
});

export const PunchOutput = z.object({
  punches: z.array(
    z.object({
      insightId: z.string(),
      structure: z.enum(STRUCTURES),
      emoji: z.string(),
      text: z.string().max(200),
    }),
  ),
});

export const EditorOutput = z.object({
  scores: z.array(
    z.object({
      id: z.string(),
      surprise: Score05,
      specificity: Score05,
      punch: Score05,
      rhythm: Score05,
      clarity: Score05,
      duplicateOf: z.string().nullable(),
      broken: z.boolean(),
    }),
  ),
  picked: z.array(z.string()),
});

export const ModeratorOutput = z.object({
  verdicts: z.array(
    z.object({ id: z.string(), hitsClosedTopic: z.boolean(), selfContained: z.boolean() }),
  ),
});

// ---------------------------------------------------------------------------
// Проверка кодом: мягкие оболочки и построчные схемы элементов.
// ---------------------------------------------------------------------------

/** Текст модели: чистка и потолок длины (по кодпоинтам); пустой после чистки не проходит. */
export const LlmText = (cap: number) =>
  z
    .string()
    .transform((s) => capCodepoints(sanitizeText(s), cap))
    .pipe(z.string().min(1));

/** То же, но `null` и пустая строка дают `null`. */
export const LlmNullableText = (cap: number) =>
  z
    .string()
    .nullable()
    .transform((s) => (s === null ? null : capCodepoints(sanitizeText(s), cap) || null));

/**
 * Текст профиля: модель читает картинки, а текст на фото PII-чистку не проходил (телефон на
 * обложке «Запись: +7 …»), и промпт просит копировать текст обложек дословно. Профиль кормит
 * шутки, а шутки уходят в публичный артефакт: тот же `cleanUntrusted`, что у подписей и у
 * досье `analyze` (`analyze/postprocess.ts`). Телефоны, почта, ссылки, карты, адреса вырезаются.
 */
const scrubbed = (s: string, cap: number) => capCodepoints(cleanUntrusted(s).text, cap);

export const ProfileText = (cap: number) =>
  z
    .string()
    .transform((s) => scrubbed(s, cap))
    .pipe(z.string().min(1));

export const ProfileNullableText = (cap: number) =>
  z
    .string()
    .nullable()
    .transform((s) => (s === null ? null : scrubbed(s, cap) || null));

const LlmId = z
  .string()
  .transform((s) => sanitizeText(s))
  .pipe(z.string().min(1).max(CAPS.id));

const ZERO_COVERAGE = {
  appearance: 0,
  work: 0,
  lifestyle: 0,
  selfImage: 0,
  quotes: 0,
  contradictions: 0,
  awkward: 0,
  biography: 0,
};

/**
 * Каркас профиля. Строго только то, без чего шаг опасен или бессмыслен: `minorSignals`, факты и
 * закрытые темы. Второстепенное (покрытие, пол, свой юмор) при кривом значении берёт запасное:
 * ретрай профиля стоит дороже всех остальных вызовов.
 */
export const ProfileCore = z.object({
  person: z
    .object({
      callName: ProfileNullableText(CAPS.callName).catch(null),
      gender: z.enum(GENDERS).catch("unknown"),
      ageStated: ProfileNullableText(CAPS.ageStated).catch(null),
    })
    .catch({ callName: null, gender: "unknown", ageStated: null }),
  coverage: ProfileOutput.shape.coverage.catch(ZERO_COVERAGE),
  keyObservation: ProfileText(CAPS.keyObservation).catch("(нет)"),
  ownHumor: ProfileNullableText(CAPS.ownHumor).catch(null),
  minorSignals: z.boolean(),
  facts: z.array(z.unknown()),
  // Закрытые темы входят в список «нельзя» дальше: без них ответ не принимаем.
  closedTopics: z.array(z.unknown()),
  quotes: z.array(z.unknown()).catch([]),
  audience: z.array(z.unknown()).catch([]),
  unknowns: z.array(z.unknown()).catch([]),
});

export const FactItem = z.object({
  section: z.enum(SECTIONS),
  text: ProfileText(CAPS.factText),
  source: ProfileText(CAPS.source),
  basis: z.enum(FACT_BASES),
});
export const QuoteItem = z.object({
  text: ProfileText(CAPS.quoteText),
  source: ProfileText(CAPS.source),
  about: ProfileText(CAPS.about),
});
export const AudienceItem = z.object({
  text: ProfileText(CAPS.audienceText),
  source: ProfileText(CAPS.source),
});

export const InsightsEnvelope = z.object({ insights: z.array(z.unknown()) });
export const InsightItem = z.object({
  title: LlmText(CAPS.insightTitle),
  factIds: z.array(z.string()),
  insight: LlmText(CAPS.insight),
  directions: z.array(z.unknown()).catch([]),
  potential: z.number().int().min(1).max(5),
  risk: LlmNullableText(CAPS.risk),
});

export const SelectEnvelope = z.object({ picks: z.array(z.unknown()) });
export const SelectItem = z.object({
  id: LlmId,
  theme: LlmText(CAPS.theme),
  mechanic: LlmText(CAPS.mechanic),
  score: z.number().int().min(1).max(10),
});

export const PunchEnvelope = z.object({ punches: z.array(z.unknown()) });
export const PunchItem = z.object({
  insightId: z.string(),
  structure: z.enum(STRUCTURES),
  emoji: z.string(),
  text: z.string(),
});

export const EditorEnvelope = z.object({
  scores: z.array(z.unknown()),
  picked: z.array(z.unknown()).catch([]),
});
export const EditorItem = z.object({
  id: z.string(),
  surprise: Score05,
  specificity: Score05,
  punch: Score05,
  rhythm: Score05,
  clarity: Score05,
  duplicateOf: z.string().nullable().catch(null),
  broken: z.boolean(),
});
export type EditorItem = z.infer<typeof EditorItem>;

export const ModeratorEnvelope = z.object({ verdicts: z.array(z.unknown()) });
export const ModeratorItem = z.object({
  id: z.string(),
  hitsClosedTopic: z.boolean(),
  selfContained: z.boolean(),
});
export type ModeratorItem = z.infer<typeof ModeratorItem>;

// ---------------------------------------------------------------------------
// Принятое кодом (с id). Эти же схемы проверяют трассу перед записью в БД.
// ---------------------------------------------------------------------------

/**
 * Потолок хранимого текста. Код режет по кодпоинтам (`capCodepoints`), а `z.string().max` считает
 * единицы UTF-16: эмодзи занимает две, поэтому запас вдвое.
 */
const Capped = (cap: number) =>
  z
    .string()
    .min(1)
    .max(cap * 2);

export const ProfileFactSchema = z.object({
  id: z.string().max(CAPS.id),
  section: z.enum(SECTIONS),
  text: Capped(CAPS.factText),
  source: Capped(CAPS.source),
  basis: z.enum(FACT_BASES),
});
export type ProfileFact = z.infer<typeof ProfileFactSchema>;

export const ProfileQuoteSchema = z.object({
  id: z.string().max(CAPS.id),
  text: Capped(CAPS.quoteText),
  source: Capped(CAPS.source),
  about: Capped(CAPS.about),
});
export type ProfileQuote = z.infer<typeof ProfileQuoteSchema>;

export const ComedyProfileSchema = z.object({
  person: z.object({
    callName: Capped(CAPS.callName).nullable(),
    gender: z.enum(GENDERS),
    ageStated: Capped(CAPS.ageStated).nullable(),
  }),
  facts: z.array(ProfileFactSchema).max(45),
  quotes: z.array(ProfileQuoteSchema).max(10),
  audience: z
    .array(z.object({ text: Capped(CAPS.audienceText), source: Capped(CAPS.source) }))
    .max(6),
  unknowns: z.array(Capped(CAPS.unknown)).max(10),
  coverage: ProfileOutput.shape.coverage,
  keyObservation: Capped(CAPS.keyObservation),
  ownHumor: Capped(CAPS.ownHumor).nullable(),
  closedTopics: z.array(Capped(CAPS.closedTopic)).max(8),
  minorSignals: z.boolean(),
});
export type ComedyProfile = z.infer<typeof ComedyProfileSchema>;

export const InsightSchema = z.object({
  id: z.string().max(CAPS.id),
  category: z.enum(INSIGHT_CATEGORIES),
  title: Capped(CAPS.insightTitle),
  factIds: z.array(z.string().max(CAPS.id)).min(1).max(4),
  insight: Capped(CAPS.insight),
  directions: z.array(Capped(CAPS.direction)).max(2),
  potential: z.number().int().min(1).max(5),
  risk: Capped(CAPS.risk).nullable(),
});
export type Insight = z.infer<typeof InsightSchema>;

export const SelectionPickSchema = z.object({
  id: z.string().max(CAPS.id),
  theme: Capped(CAPS.theme),
  mechanic: Capped(CAPS.mechanic),
  /** `null` у добранных кодом (модель их не оценивала). */
  score: z.number().int().min(1).max(10).nullable(),
});
export type SelectionPick = z.infer<typeof SelectionPickSchema>;

export const SelectionSchema = z.object({
  picks: z.array(SelectionPickSchema).max(15),
  work: z.array(z.string().max(CAPS.id)).max(15),
  reserve: z.array(z.string().max(CAPS.id)).max(15),
  /** Сколько инсайтов добрал код по `potential`, потому что отбор вернул меньше нужного. */
  toppedUp: z.number().int().min(0),
});
export type Selection = z.infer<typeof SelectionSchema>;

/** Оценки редактора 0–5. */
export type EditorScores = Pick<
  EditorItem,
  "surprise" | "specificity" | "punch" | "rhythm" | "clarity"
>;

export function editorTotal(s: EditorScores): number {
  return s.surprise + s.specificity + s.punch + s.rhythm + s.clarity;
}
