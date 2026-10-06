import type { GenerationMode, Level } from "@/contracts";
import type { JudgePromptInput, WriterPromptInput } from "../prompts/roast/v2";
import type { ModeratorPromptInput } from "../prompts/roast/moderator-v2";

// Пакет вкуса: всё, по чему пишутся шутки, под одним именем `taste/vN` (plans/humor-build.md, H1).
// `taste/vN` версия ПАКЕТА, `roast/vN` версия промпта ВНУТРИ него: пакет может сменить гайд или
// полку без нового промпта, и наоборот. Пакет не секрет в смысле `.env`, но тексты промптов лежат
// в `src/server/prompts/**` и в клиентский бандл не попадают (инвариант про утечку промптов).

export type PromptText = { system: string; user: string };

/** Роль модели в пакете: версия промпта и сборщик. */
type Role<Input> = {
  /** `roast/vN`, `roast/moderator-vN`: пишется в `punch_candidates.promptVersion` и в трассу. */
  version: string;
  buildPrompt: (input: Input) => PromptText;
};

export type TastePack = {
  /** `taste/v1`, `taste/v2` …: пишется в трассу каждой шутки (`PunchTrace.tastePack`). */
  name: string;
  writer: Role<WriterPromptInput> & {
    buildSystem: (level: Level, mode: GenerationMode) => string;
    /** Id крючка в виде, в каком его видит модель (после чистки). */
    hookId: (id: string) => string;
  };
  judge: Role<JudgePromptInput> & { system: string };
  moderator: Role<ModeratorPromptInput> & { system: string };
  /** Порог судьи по «про поведение» и «тепло»: ниже кандидат вырезается (§5.5). */
  judgeThresholds: (level: Level) => { aboutBehavior: number; warmth: number };

  // Места под материалы вкуса. В `taste/v1` их нет, поля необязательные; формат карточек — H2.
  /** Гайд вкуса: текст, который пакет добавит в промпт писателя. */
  guide?: string;
  /** Золотая полка: эталонные шутки. */
  goldenShelf?: readonly string[];
  /** Антипримеры: так писать нельзя. */
  antiExamples?: readonly string[];
  /** Карточки методик (формат задаёт H2). */
  methodCards?: readonly unknown[];
};
