import type { GenerationMode } from "@/contracts";
import { capCodepoints } from "../facts/text";
import { buildInsightsPrompt } from "../prompts/comedy/insights-v1";
import { buildSelectPrompt } from "../prompts/comedy/select-v1";
import { WriteFailedError } from "../roast/write/types";
import {
  INSIGHT_CATEGORIES,
  INSIGHTS_PER_CATEGORY,
  MAX_INSIGHT_DIRECTIONS,
  MAX_INSIGHT_FACTS,
  SELECT_INSIGHTS,
  WORK_INSIGHTS,
  type InsightCategory,
} from "./config";
import { profileFactIds } from "./profile";
import { logComedy, settleBatches, withRetries, type Parsed } from "./retry";
import {
  CAPS,
  InsightItem,
  InsightsEnvelope,
  LlmText,
  SelectEnvelope,
  SelectItem,
  type ComedyProfile,
  type Insight,
  type Selection,
  type SelectionPick,
} from "./schema";
import type { ComedyGenerateFn } from "./types";

// Шаг 2 (comedy-engine §7.2–§7.3): три категории инсайтов параллельно, затем отбор 15 (10 в
// работу + 5 в запас). Id `A1`, `B1`, `C1` ставит код; `factIds` — только существующие F/Q.

/** Id из ответа модели в виде профиля: без скобок и пробелов, заглавными (`[f3]` → `F3`). */
export function normalizeRefId(raw: string): string {
  return raw.replace(/[\s[\]«»"']/g, "").toUpperCase();
}

/** Опорные id инсайта: только существующие в профиле, без повторов, не больше 4. */
export function keepKnownFacts(raw: readonly string[], known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const id of raw.map(normalizeRefId)) {
    if (known.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_INSIGHT_FACTS) break;
  }
  return out;
}

const direction = LlmText(CAPS.direction);

export function parseInsights(
  raw: unknown,
  category: InsightCategory,
  known: ReadonlySet<string>,
): Parsed<Insight[]> {
  const env = InsightsEnvelope.safeParse(raw);
  if (!env.success) return { ok: false, note: "ответ не по схеме: нужен объект insights" };
  const max = INSIGHTS_PER_CATEGORY[category][1];
  const out: Insight[] = [];
  for (const item of env.data.insights) {
    if (out.length >= max) break;
    const parsed = InsightItem.safeParse(item);
    if (!parsed.success) continue;
    const factIds = keepKnownFacts(parsed.data.factIds, known);
    // Инсайт без опоры на существующие факты удаляется.
    if (factIds.length === 0) continue;
    const directions = parsed.data.directions.flatMap((d) => {
      const r = direction.safeParse(d);
      return r.success ? [r.data] : [];
    });
    out.push({
      id: `${category}${out.length + 1}`,
      category,
      title: parsed.data.title,
      factIds,
      insight: parsed.data.insight,
      directions: directions.slice(0, MAX_INSIGHT_DIRECTIONS),
      potential: parsed.data.potential,
      risk: parsed.data.risk,
    });
  }
  if (out.length === 0) {
    return {
      ok: false,
      note: "ни одного инсайта с опорой: factIds только из id профиля (F1, Q1), potential целое 1–5",
    };
  }
  return { ok: true, value: out };
}

export type InsightsContext = {
  profile: ComedyProfile;
  mode: GenerationMode;
  forbidden: readonly string[];
  generate: ComedyGenerateFn;
};

/** Три категории параллельно. Категория, исчерпавшая ретраи, отпадает; отпали все — `llm_failed`. */
export async function findInsights(ctx: InsightsContext): Promise<Insight[]> {
  const known = profileFactIds(ctx.profile);
  const parts = await settleBatches(
    "инсайты",
    INSIGHT_CATEGORIES.map((category) =>
      withRetries(
        `инсайты ${category}`,
        ({ retryNote }) =>
          buildInsightsPrompt({
            profile: ctx.profile,
            mode: ctx.mode,
            forbidden: ctx.forbidden,
            category,
            range: INSIGHTS_PER_CATEGORY[category],
            retryNote,
          }),
        ctx.generate,
        (raw) => parseInsights(raw, category, known),
      ),
    ),
  );
  return parts.flat();
}

const factKey = (i: Insight) => [...i.factIds].sort().join("|");

/**
 * Два инсайта на одной опоре: общих фактов не меньше половины меньшего набора (`[F1, F2]` и
 * `[F2, F5]` — одна тема, `[F1, F2, F3]` и `[F3, F7, F8]` — разные). Так ловятся инсайты «про
 * одно и то же» разными словами, а не только с точно одинаковой связкой.
 */
export function factsOverlap(a: readonly string[], b: readonly string[]): boolean {
  const own = new Set(a);
  const shared = b.filter((id) => own.has(id)).length;
  return shared > 0 && shared * 2 >= Math.min(a.length, b.length);
}

/**
 * Отбор кодом поверх ответа: только существующие id, без повторов; из двух выбранных с
 * пересекающейся опорой (`factsOverlap`) вторая выбывает.
 */
export function parseSelection(
  raw: unknown,
  insights: readonly Insight[],
): Parsed<SelectionPick[]> {
  const env = SelectEnvelope.safeParse(raw);
  if (!env.success) return { ok: false, note: "ответ не по схеме: нужен объект picks" };
  const byId = new Map(insights.map((i) => [i.id, i]));
  const picks: SelectionPick[] = [];
  const chosen: Insight[] = [];
  for (const item of env.data.picks) {
    if (picks.length >= SELECT_INSIGHTS) break;
    const parsed = SelectItem.safeParse(item);
    if (!parsed.success) continue;
    const insight = byId.get(normalizeRefId(parsed.data.id));
    if (!insight || chosen.includes(insight)) continue;
    if (chosen.some((c) => factsOverlap(c.factIds, insight.factIds))) continue;
    chosen.push(insight);
    picks.push({ ...parsed.data, id: insight.id });
  }
  if (picks.length === 0) {
    return {
      ok: false,
      note: "ни одного валидного выбора: id только из <insights>, score целое 1–10",
    };
  }
  return { ok: true, value: picks };
}

/**
 * Добор кодом, если отбор вернул меньше нужного (или упал целиком): оставшиеся инсайты по
 * `potential`. Сначала без пересечения опоры с уже выбранными (`factsOverlap`), а если так не
 * набрать — без точного повтора связки фактов. Без добора недобор отбора ронял бы генерацию.
 */
export function topUpPicks(
  picks: readonly SelectionPick[],
  insights: readonly Insight[],
  target: number,
): SelectionPick[] {
  const out = [...picks];
  const used = new Set(out.map((p) => p.id));
  const chosen = insights.filter((i) => used.has(i.id));
  const rest = insights
    .map((insight, order) => ({ insight, order }))
    .filter(({ insight }) => !used.has(insight.id))
    .sort((a, b) => b.insight.potential - a.insight.potential || a.order - b.order)
    .map(({ insight }) => insight);
  const strict = (i: Insight) => !chosen.some((c) => factsOverlap(c.factIds, i.factIds));
  const loose = (i: Insight) => !chosen.some((c) => factKey(c) === factKey(i));
  for (const allowed of [strict, loose]) {
    for (const insight of rest) {
      if (out.length >= target) break;
      if (chosen.includes(insight) || !allowed(insight)) continue;
      chosen.push(insight);
      out.push({
        id: insight.id,
        theme: capCodepoints(insight.title, CAPS.theme),
        mechanic: `категория ${insight.category}`,
        score: null,
      });
    }
  }
  return out;
}

export async function selectInsights(
  profile: ComedyProfile,
  insights: readonly Insight[],
  generate: ComedyGenerateFn,
): Promise<Selection> {
  const count = Math.min(SELECT_INSIGHTS, insights.length);
  let picks: SelectionPick[] = [];
  try {
    picks = await withRetries(
      "отбор",
      ({ retryNote }) => buildSelectPrompt({ profile, insights, count, retryNote }),
      generate,
      (raw) => parseSelection(raw, insights),
    );
  } catch (error) {
    // Отбор упал целиком: ранжируем кодом по `potential`, генерацию не роняем.
    if (!(error instanceof WriteFailedError) || error.reason !== "llm_failed") throw error;
    logComedy("отбор не получился, ранжир кодом");
  }
  const all = topUpPicks(picks, insights, count);
  return {
    picks: all,
    work: all.slice(0, WORK_INSIGHTS).map((p) => p.id),
    reserve: all.slice(WORK_INSIGHTS, SELECT_INSIGHTS).map((p) => p.id),
    toppedUp: all.length - picks.length,
  };
}
