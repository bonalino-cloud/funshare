import { ANALYZE_SYSTEM as ANALYZE_V1 } from "./analyze/v1";
import { EDITOR_SYSTEM as COMEDY_EDITOR_V1 } from "./comedy/editor-v1";
import { INSIGHTS_SYSTEM as COMEDY_INSIGHTS_V1 } from "./comedy/insights-v1";
import { MODERATOR_SYSTEM as COMEDY_MODERATOR_V1 } from "./comedy/moderator-v1";
import { PROFILE_SYSTEM as COMEDY_PROFILE_V1 } from "./comedy/profile-v1";
import { PUNCH_SYSTEM as COMEDY_PUNCH_V1 } from "./comedy/punch-v1";
import { SELECT_SYSTEM as COMEDY_SELECT_V1 } from "./comedy/select-v1";
import { ANALYZE_SYSTEM as ANALYZE_V2 } from "./analyze/v2";
import { ANALYZE_SYSTEM as ANALYZE_V3 } from "./analyze/v3";
import { MODERATOR_SYSTEM as MODERATOR_V1 } from "./roast/moderator-v1";
import { MODERATOR_SYSTEM as MODERATOR_V2 } from "./roast/moderator-v2";
import { buildWriterSystem as writerV1, JUDGE_SYSTEM as JUDGE_V1 } from "./roast/v1";
import { buildWriterSystem as writerV2, JUDGE_SYSTEM as JUDGE_V2 } from "./roast/v2";

// ВСЕ опубликованные версии системных промптов, а не только активные: проверка утечек (слой 4
// фильтров, CI-проверка бандла) должна ловить и откатные версии, и v1 в старых трассах и кэшах.
// Выпуск новой версии: добавить её сюда, иначе утечка нового текста останется незамеченной
// (тест в `canary.test.ts` сверяет этот список с `active.ts`).

const LEVELS = ["rare", "medium", "well_done"] as const;
const MODES = ["self", "friend"] as const;

/** Писатель (все степени и режимы), судья и модератор всех версий. */
export function allWriteSystemPrompts(): string[] {
  const out: string[] = [JUDGE_V1, JUDGE_V2, MODERATOR_V1, MODERATOR_V2];
  for (const level of LEVELS) {
    for (const mode of MODES) out.push(writerV1(level, mode), writerV2(level, mode));
  }
  return out;
}

/** Досье всех версий. */
export function allAnalyzeSystemPrompts(): string[] {
  return [ANALYZE_V1, ANALYZE_V2, ANALYZE_V3];
}

/** Comedy-движок well done (comedy-engine §7): шесть шагов всех версий. */
export function allComedySystemPrompts(): string[] {
  return [
    COMEDY_PROFILE_V1,
    COMEDY_INSIGHTS_V1,
    COMEDY_SELECT_V1,
    COMEDY_PUNCH_V1,
    COMEDY_EDITOR_V1,
    COMEDY_MODERATOR_V1,
  ];
}
