import type { GenerationMode, Level, PersonaProfile, Tier } from "@/contracts";
import type { ProfileFacts } from "../../facts";
import type { JokeLabel } from "../jokes/card";

// Типы шага `write` (roast-engine §5.2–§5.5). Чистые типы: без БД, env и LLM.

/** Тип крючка: от него зависят подходящие слоты банка и разнообразие набора (§5.2). */
export type HookKind = "content" | "rhythm" | "habit";

/** Крючок = наблюдение досье, прошедшее отбор. `id` — наблюдение из `PersonaProfile`. */
export type Hook = {
  id: string;
  claim: string;
  evidence: string[];
  recognizability: number;
  kind: HookKind;
  /** Есть ли в наблюдении цифра из ProfileFacts или из текста. */
  hasNumber: boolean;
};

/** Карточка банка в виде, пригодном для промпта: скелет или образец. */
export type StyleCard = {
  /** Короткий ключ внутри крючка (`s1`, `s2`, `e1` …): модель ссылается на него, не на id банка. */
  ref: string;
  /** Настоящий id карточки банка. Наружу и в промпт не идёт, только в приватную трассу. */
  cardId: string;
  mechanism: JokeLabel["mechanism"];
  skeleton: string;
  /** Текст оригинала только у образцов. */
  text: string | null;
};

export type HookStyle = { hook: Hook; skeletons: StyleCard[]; examples: StyleCard[] };

/** Пять оценок судьи 0–5 (§5.5). */
export type JudgeScores = {
  recognizability: number;
  surprise: number;
  brevity: number;
  aboutBehavior: number;
  warmth: number;
};

/** Приватная трасса кандидата: в ответы API не попадает (инвариант 20). */
export type PunchTrace = {
  hookId: string;
  mechanism: JokeLabel["mechanism"];
  evidenceRef: string;
  /** Карточка банка, чей скелет дан писателю; `null`, если модель не сослалась ни на один. */
  jokeCardId: string | null;
  scores: JudgeScores | null;
  totalScore: number | null;
  promptVersion: string;
  writerModel: string;
  judgeModel: string;
};

export type WrittenCandidate = {
  /** Идентификатор для `CandidatesResponse`: уникален в рамках генерации. */
  id: string;
  emoji: string;
  text: string;
  fromTrial: boolean;
  trace: PunchTrace;
};

/** Выбранная в Поджоге шутка, перенесённая в Кострище: `id` сохраняется. */
export type CarriedPunch = { id: string; emoji: string; text: string; trace: PunchTrace };

export type WriteInput = {
  persona: PersonaProfile;
  facts: ProfileFacts;
  /** Факты от пользователя: недоверенный текст. */
  extraFacts: string[];
  mode: GenerationMode;
  level: Level;
  tier: Tier;
  carried?: CarriedPunch[];
};

export type WriteStats = {
  rounds: number;
  written: number;
  droppedInvalid: number;
  droppedByJudge: number;
  unscored: number;
};

/** Причина провала шага: наружу (в логи) — только код. */
export type WriteFailureReason =
  | "no_hooks"
  | "not_enough_candidates"
  | "llm_failed"
  /** Нет строки генерации, проверки профиля, снимка или досье (снимки чистит Cron). */
  | "no_input"
  /** Досье или снимок не прошли схему, либо в досье стоит флаг гардрейла. */
  | "bad_input"
  /** Собранный список не прошёл контракт `CandidatesResponse`. */
  | "invalid_output";

export class WriteFailedError extends Error {
  constructor(readonly reason: WriteFailureReason) {
    super(`write failed: ${reason}`);
    this.name = "WriteFailedError";
  }
}
