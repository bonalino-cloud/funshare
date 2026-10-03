import { z } from "zod";

// «Мягкая» схема ответа модели. Ограничения контракта (длины, min/max, id, evidence) сюда
// намеренно не попадают: их применяет код после ответа (postprocess.ts), а строгий
// `PersonaProfile.parse` стоит последним. Так модель не «падает» по мелочи, а в JSON Schema
// для провайдера уходят только простые типы.

const Strings = z.array(z.string());

export const LlmDossier = z.object({
  language: z.string().describe("ISO 639-1, язык профиля"),
  summary: z.string(),
  vibe: z.string(),
  traits: Strings,
  interests: Strings,
  habits: Strings,
  aesthetics: z.string(),
  humorAngles: Strings,
  avoidTopics: Strings,
  look: z
    .object({
      description: z.string(),
      referenceIndexes: z.array(z.number()).describe("номера постов из присланных обложек"),
    })
    .nullable(),
  observations: z.array(
    z.object({
      claim: z.string(),
      evidence: Strings,
      recognizability: z.number(),
      safe: z.boolean(),
    }),
  ),
  warmFacts: Strings,
  signatureMoves: Strings,
  sensitiveEvents: Strings,
  /** `isPrivate` у модели нет: это знает код по снимку. */
  flags: z.object({ likelyMinor: z.boolean(), insufficientData: z.boolean() }),
});
export type LlmDossier = z.infer<typeof LlmDossier>;
