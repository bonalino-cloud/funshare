import type { GenerationMode, Level } from "@/contracts";
import type { EditorScores, ComedyProfile, Structure } from "./schema";
import type { ComedyCounters, ComedyTraceEntry, ComedyTraceRecorder } from "./trace";
import type { ComedyDeps } from "./types";

// Общее состояние одного запуска comedy-движка: кандидат и контекст подшагов.

/** Кандидат, прошедший проверку кодом и слой 4. `entry` — его живая запись в трассе. */
export type Candidate = {
  round: number;
  insightId: string;
  structure: Structure;
  emoji: string;
  text: string;
  /** Нормализованный текст для поиска дублей. */
  key: string;
  entry: ComedyTraceEntry;
  /** Оценки редактора; `null`, пока не оценён или редактор его пропустил. */
  scores: EditorScores | null;
  total: number | null;
  /** Редактор считает его повтором этого кандидата (той же ассоциации). */
  dupOf: Candidate | null;
};

export type RunContext = {
  level: Level;
  mode: GenerationMode;
  /** Список «нельзя»: `sensitiveEvents` досье ∪ `closedTopics` профиля. */
  forbidden: readonly string[];
  /** Деликатно, лучше обходить: `avoidTopics` досье (не красная линия, модератору не уходят). */
  delicate: readonly string[];
  /** Тяжёлые события досье: шутка с двумя основами одного события вычёркивается кодом. */
  sensitiveEvents: readonly string[];
  profile: ComedyProfile;
  deps: ComedyDeps;
  rec: ComedyTraceRecorder;
  counters: ComedyCounters;
};
