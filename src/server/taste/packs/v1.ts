import {
  buildJudgePrompt,
  buildModeratorPrompt,
  buildWriterPrompt,
  buildWriterSystem,
  JUDGE_SYSTEM,
  MODERATOR_PROMPT_VERSION,
  MODERATOR_SYSTEM,
  promptHookId,
  ROAST_PROMPT_VERSION,
} from "../../prompts/active";
import { judgeThresholds } from "../../roast/write/config";
import type { TastePack } from "../types";

// `taste/v1`: базовая линия = активные промпты на момент H1 (писатель и судья `roast/v2`,
// модератор `moderator-v2` с политикой тем 14а и решением 2026-10-06 про слова о теле) и пороги
// судьи. Источник промптов `prompts/active.ts`: откат версии промпта остаётся заменой одной строки
// импорта там; смена гайда или полки без нового промпта делается новым пакетом, не правкой этого.
// Красные линии слоя 4 (`roast/filters`) общие для всех пакетов и в пакет не входят.
export const TASTE_V1: TastePack = {
  name: "taste/v1",
  writer: {
    version: ROAST_PROMPT_VERSION,
    buildSystem: buildWriterSystem,
    buildPrompt: buildWriterPrompt,
    hookId: promptHookId,
  },
  judge: { version: ROAST_PROMPT_VERSION, system: JUDGE_SYSTEM, buildPrompt: buildJudgePrompt },
  moderator: {
    version: MODERATOR_PROMPT_VERSION,
    system: MODERATOR_SYSTEM,
    buildPrompt: buildModeratorPrompt,
  },
  judgeThresholds,
};
