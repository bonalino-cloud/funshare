import type { GenerationMode, Level, PersonaProfile, Tier } from "@/contracts";
import type { ProfileFacts } from "../../facts";
import type { FilterReport } from "../filters";
import type { JokeLabel } from "../jokes/card";
import type { WriteTrace } from "./trace";

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
  /** Пакет вкуса (`taste/vN`), по которому написана шутка; `promptVersion` — промпт внутри него. */
  tastePack: string;
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
  /** Имя пакета вкуса; нет — текущий (`CURRENT_TASTE_PACK`). Неизвестное имя: ошибка до LLM. */
  tastePack?: string;
  carried?: CarriedPunch[];
};

export type WriteStats = {
  rounds: number;
  written: number;
  /** Вычеркнуто слоем 4 (форма, язык, запретные темы, мат, штампы, дубли, утечка промпта). */
  droppedInvalid: number;
  droppedByJudge: number;
  unscored: number;
  /** Вычеркнуто модератором (слой 5). */
  droppedByModerator: number;
  /** Модератор не вернул вердикт: показывать непроверенное нельзя, кандидат отпал. */
  unmoderated: number;
  /** Разбивка по слоям и кодам причин (в `generation_traces`, задача 13). */
  filters: FilterReport;
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
  /** Трасса провалившегося запуска для `generation_traces`: ставит `writeCandidates`. */
  trace: WriteTrace | null = null;

  constructor(readonly reason: WriteFailureReason) {
    super(`write failed: ${reason}`);
    this.name = "WriteFailedError";
  }
}
