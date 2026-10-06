import * as analyze from "./analyze/v2";
import * as roast from "./roast/v2";
import * as moderator from "./roast/moderator-v2";

// ЕДИНСТВЕННАЯ точка выбора активных версий промптов. Откат роли — замена номера версии в ОДНОЙ
// строке импорта выше (`./roast/v2` → `./roast/v1`); остальной код читает версии только отсюда.
// Версия пишется в запись (`personas.promptVersion`, трасса кандидатов), поэтому откат не ломает
// данные: старые записи остаются с версией, под которой созданы. Новая версия: добавить файл
// `v<N>.ts`, заменить импорт здесь и добавить её в `registry.ts` (проверка утечек).
//
// Откат промптов НЕ откатывает слой 4: списки `roast/filters/lexicon.ts` уже под политику 14а
// (семья, деньги, вес открыты). При откате на v1 эти темы держат промпт v1 и модератор v1.
//
// Типы промптов структурно одинаковы у всех версий роли: v2 не меняет форму входа и выхода.

// Досье (`analyze`).
export const {
  buildAnalyzePrompt,
  ANALYZE_SYSTEM,
  PROMPT_VERSION: ANALYZE_PROMPT_VERSION,
} = analyze;
export type AnalyzePromptPart = analyze.AnalyzePromptPart;
export type AnalyzePrompt = analyze.AnalyzePrompt;

// Писатель и судья (`write`).
export const {
  buildWriterPrompt,
  buildJudgePrompt,
  buildWriterSystem,
  JUDGE_SYSTEM,
  promptHookId,
  PROMPT_VERSION: ROAST_PROMPT_VERSION,
} = roast;

// Модератор (`write`, слой 5).
export const { buildModeratorPrompt, MODERATOR_SYSTEM, MODERATOR_PROMPT_VERSION } = moderator;
