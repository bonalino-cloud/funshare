import { buildModeratorPrompt } from "../prompts/comedy/moderator-v1";
import { bump, type Layer5Code } from "../roast/filters";
import { WriteFailedError } from "../roast/write/types";
import { MODERATOR_PER_CALL } from "./config";
import { chunk, settleBatches, withRetries } from "./retry";
import { ModeratorEnvelope, ModeratorItem } from "./schema";
import type { Candidate, RunContext } from "./state";

// Шаг 5 (comedy-engine §7.6): модератор well done, только красные линии и логика. Жёсткость,
// мат, внешность и секс не режет. Нет вердикта — кандидат вычеркнут: непроверенное не показываем.

/** Причина вычёркивания или `null`, если шутку можно показывать. */
export function comedyModerationReason(v: ModeratorItem): Layer5Code | null {
  if (v.hitsClosedTopic) return "forbidden_topic";
  if (!v.selfContained) return "unclear";
  return null;
}

async function verdicts(
  ids: readonly { id: string; c: Candidate }[],
  ctx: RunContext,
): Promise<Map<string, ModeratorItem>> {
  const results = await settleBatches(
    "модератор",
    chunk(ids, MODERATOR_PER_CALL).map((part) =>
      withRetries(
        "модератор",
        ({ retryNote }) =>
          buildModeratorPrompt({
            forbidden: ctx.forbidden,
            candidates: part.map(({ id, c }) => ({ id, text: c.text })),
            retryNote,
          }),
        ctx.deps.moderator,
        (raw) => {
          const env = ModeratorEnvelope.safeParse(raw);
          if (!env.success) return { ok: false, note: "ответ не по схеме: нужен объект verdicts" };
          const own = new Set(part.map(({ id }) => id));
          const byId = new Map<string, ModeratorItem>();
          for (const item of env.data.verdicts) {
            const parsed = ModeratorItem.safeParse(item);
            if (!parsed.success) continue;
            const id = parsed.data.id.trim().toLowerCase();
            if (own.has(id) && !byId.has(id)) byId.set(id, parsed.data);
          }
          if (byId.size === 0) {
            return {
              ok: false,
              note: "ни одного валидного вердикта: id как во входе, hitsClosedTopic и selfContained true/false",
            };
          }
          return { ok: true, value: byId };
        },
      ),
    ),
  );
  const out = new Map<string, ModeratorItem>();
  for (const r of results) for (const [id, v] of r) out.set(id, v);
  return out;
}

function markUnmoderated(c: Candidate, ctx: RunContext): void {
  ctx.counters.unmoderated++;
  bump(ctx.counters.filters.layer5, "no_verdict");
  c.entry.outcome = "unmoderated";
  c.entry.reason = "no_verdict";
}

/**
 * Один проход модератора над `batch`, пачками по `MODERATOR_PER_CALL`. Возвращает прошедших.
 * Модератор лёг целиком, но одобренные уже есть (`hasApproved`): не теряем их, кандидаты прохода
 * считаются непроверенными. Одобренных нет — `llm_failed` летит дальше.
 */
export async function moderatePass(
  batch: readonly Candidate[],
  hasApproved: boolean,
  ctx: RunContext,
): Promise<Candidate[]> {
  if (batch.length === 0) return [];
  ctx.counters.filters.moderatorChecked += batch.length;
  ctx.counters.filters.moderatorPasses++;
  const ids = batch.map((c, i) => ({ id: `m${i + 1}`, c }));
  let byId: Map<string, ModeratorItem>;
  try {
    byId = await verdicts(ids, ctx);
  } catch (error) {
    if (!(error instanceof WriteFailedError) || error.reason !== "llm_failed" || !hasApproved) {
      throw error;
    }
    for (const c of batch) markUnmoderated(c, ctx);
    return [];
  }
  const passed: Candidate[] = [];
  for (const { id, c } of ids) {
    const v = byId.get(id);
    if (!v) {
      markUnmoderated(c, ctx);
      continue;
    }
    c.entry.verdict = { hitsClosedTopic: v.hitsClosedTopic, selfContained: v.selfContained };
    const reason = comedyModerationReason(v);
    if (reason) {
      ctx.counters.droppedByModerator++;
      bump(ctx.counters.filters.layer5, reason);
      c.entry.outcome = "dropped_layer5";
      c.entry.reason = reason;
      continue;
    }
    passed.push(c);
  }
  return passed;
}
