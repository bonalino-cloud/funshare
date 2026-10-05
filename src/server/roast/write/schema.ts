import { z } from "zod";
import { JOKE_MECHANISMS } from "../jokes/card";

// Схемы ответов писателя и судьи. Модели уходит строгая JSON Schema (`WriterOutput`, `JudgeOutput`),
// но SDK ответ НЕ валидирует: один кривой кандидат не должен ронять остальные 29. Каждый элемент
// проверяется отдельно кодом (`WriterCandidate`, `JudgeItem`) до того, как что-то попадёт в БД.

export const WriterCandidate = z.object({
  mechanism: z.enum(JOKE_MECHANISMS),
  /** Ключ скелета из банка (`s1`, `s2`) или null. */
  skeleton: z.string().nullable(),
  emoji: z.string(),
  text: z.string(),
  evidenceRef: z.string(),
});
export type WriterCandidate = z.infer<typeof WriterCandidate>;

export const WriterOutput = z.object({
  hooks: z.array(z.object({ hookId: z.string(), candidates: z.array(WriterCandidate) })),
});

/** Мягкая оболочка: элементы остаются `unknown` до построчной проверки. */
export const WriterEnvelope = z.object({
  hooks: z.array(z.object({ hookId: z.string(), candidates: z.array(z.unknown()) })),
});

const Score = z.number().int().min(0).max(5);

export const JudgeItem = z.object({
  id: z.string(),
  recognizability: Score,
  surprise: Score,
  brevity: Score,
  aboutBehavior: Score,
  warmth: Score,
});
export type JudgeItem = z.infer<typeof JudgeItem>;

export const JudgeOutput = z.object({ scores: z.array(JudgeItem) });
export const JudgeEnvelope = z.object({ scores: z.array(z.unknown()) });

/** Приватная трасса из БД (jsonb): перенос в Кострище читает её обратно, поэтому проверяем. */
export const PunchTraceSchema = z.object({
  hookId: z.string(),
  mechanism: z.enum(JOKE_MECHANISMS),
  evidenceRef: z.string(),
  jokeCardId: z.string().nullable(),
  scores: z
    .object({
      recognizability: Score,
      surprise: Score,
      brevity: Score,
      aboutBehavior: Score,
      warmth: Score,
    })
    .nullable(),
  totalScore: z.number().nullable(),
  promptVersion: z.string(),
  writerModel: z.string(),
  judgeModel: z.string(),
});
