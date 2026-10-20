import { z } from "zod";

// «Мягкая» схема ответа модели. Ограничения контракта (длины, min/max, id, evidence) сюда
// намеренно не попадают: их применяет код после ответа (postprocess.ts), а строгий
// `PersonaProfile.parse` стоит последним. Так модель не «падает» по мелочи, а в JSON Schema
// для провайдера уходят только простые типы.
//
// v3 (issue #102, 2026-10-20): вместо полного досье (~7k токенов по верхним лимитам контракта:
// summary, vibe, traits, interests, habits, aesthetics, look) модель отдаёт только крючки —
// наблюдения с опорой — и то, что нужно гардрейлам и безопасным темам. `summary`/`vibe`/`traits`/
// `interests`/`habits`/`aesthetics`/`look`/`signatureMoves` требует `PersonaProfile` (кроме
// `look`/`signatureMoves`, они опциональны); `judge` их не читает, а `write` (`roast/v2.ts`)
// держит `summary`/`vibe`/`signatureMoves` как вторичный контекст рядом с основными крючками
// (`<hooks>`) — `postprocess.ts` синтезирует их из тех же наблюдений, а не просит у модели.
// Откат на `analyze/v1` или `analyze/v2` (`prompts/active.ts`) требует вернуть и эту схему, и
// `postprocess.ts`: формы входа/выхода версий здесь разошлись.

const Strings = z.array(z.string());

export const LlmDossier = z.object({
  language: z.string().describe("ISO 639-1, язык профиля"),
  humorAngles: Strings,
  avoidTopics: Strings,
  observations: z.array(
    z.object({
      claim: z.string(),
      evidence: Strings,
      recognizability: z.number(),
      safe: z.boolean(),
    }),
  ),
  warmFacts: Strings,
  sensitiveEvents: Strings,
  /** `isPrivate` у модели нет: это знает код по снимку. */
  flags: z.object({ likelyMinor: z.boolean(), insufficientData: z.boolean() }),
});
export type LlmDossier = z.infer<typeof LlmDossier>;
