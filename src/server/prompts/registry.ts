import { ANALYZE_SYSTEM as ANALYZE_V1 } from "./analyze/v1";
import { ANALYZE_SYSTEM as ANALYZE_V2 } from "./analyze/v2";
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
  return [ANALYZE_V1, ANALYZE_V2];
}
