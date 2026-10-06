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

/** Вердикт модератора (слой 5, §6): четыре ответа «да/нет». Элемент проверяется отдельно. */
export const ModeratorItem = z.object({
  id: z.string(),
  aboutBehavior: z.boolean(),
  hitsForbiddenTopic: z.boolean(),
  friendSafe: z.boolean(),
  selfContained: z.boolean(),
});
export type ModeratorItem = z.infer<typeof ModeratorItem>;

export const ModeratorOutput = z.object({ verdicts: z.array(ModeratorItem) });
export const ModeratorEnvelope = z.object({ verdicts: z.array(z.unknown()) });

export const LEGACY_TASTE_PACK = "pre-taste";

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
  /** Записи до пакетов вкуса (H1) поля не имеют: помечаем явно, а не выдаём за `taste/v1`. */
  tastePack: z.string().default(LEGACY_TASTE_PACK),
  promptVersion: z.string(),
  writerModel: z.string(),
  judgeModel: z.string(),
});
