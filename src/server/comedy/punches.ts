import { PUNCH_MAX_CHARS } from "@/contracts";
import { sanitizeText } from "../facts/text";
import { buildPunchPrompt } from "../prompts/comedy/punch-v1";
import {
  bump,
  checkOutputText,
  defaultCanaries,
  defaultLeakIndex,
  hasCanary,
  hasPromptChain,
  mergeCounts,
  totalCount,
  type Counts,
  type Layer4Code,
} from "../roast/filters";
import {
  cleanEmoji,
  cyrillicShare,
  normalizeForDedupe,
  type Rejection,
} from "../roast/write/candidate";
import { MIN_CYRILLIC_SHARE } from "../roast/write/config";
import { overlapsForbidden } from "../roast/write/hooks";
import { PUNCH_INSIGHTS_PER_CALL, PUNCHES_PER_INSIGHT } from "./config";
import { normalizeRefId } from "./insights";
import { chunk, settleBatches, withRetries } from "./retry";
import { PunchEnvelope, PunchItem, type Insight, type Structure } from "./schema";
import type { Candidate, RunContext } from "./state";
import { newComedyEntry, type ComedyTraceEntry } from "./trace";

// Шаг 3 (comedy-engine §7.4): по 3 шутки на инсайт, пачками по 5 инсайтов параллельно. Каждая
// шутка проверяется кодом (§3): инсайт из пачки, длина ≤ PUNCH_MAX_CHARS, кириллица ≥ 0.6,
// эмодзи через `cleanEmoji`, слой 4 (`checkOutputText`, well done), запретные темы досье, дубль
// по нормализованному тексту (с выбранными в Поджоге тоже).

export type ValidPunch = { insightId: string; structure: Structure; emoji: string; text: string };

export function validatePunch(
  raw: unknown,
  byId: ReadonlyMap<string, Insight>,
): { ok: true; value: ValidPunch } | { ok: false; reason: Rejection } {
  const parsed = PunchItem.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "bad_shape" };
  const p = parsed.data;
  const insight = byId.get(normalizeRefId(p.insightId));
  if (!insight) return { ok: false, reason: "unknown_hook" };
  const text = sanitizeText(p.text);
  if (text === "") return { ok: false, reason: "empty" };
  // Контракт считает единицы UTF-16 (`z.string().max`): так же и здесь.
  if (text.length > PUNCH_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (cyrillicShare(text) < MIN_CYRILLIC_SHARE) return { ok: false, reason: "not_russian" };
  return {
    ok: true,
    value: { insightId: insight.id, structure: p.structure, emoji: cleanEmoji(p.emoji), text },
  };
}

/** Шутка как есть, без проверок: для трассы брака. `null`, если не по схеме. */
function loosePunch(raw: unknown): { structure: Structure; emoji: string; text: string } | null {
  const parsed = PunchItem.safeParse(raw);
  return parsed.success
    ? { structure: parsed.data.structure, emoji: parsed.data.emoji, text: parsed.data.text }
    : null;
}

type BatchResult = {
  accepted: Candidate[];
  dropped: ComedyTraceEntry[];
  drops: Counts<Layer4Code>;
};

function parseBatch(
  raw: unknown,
  insights: readonly Insight[],
  seen: ReadonlySet<string>,
  round: number,
  ctx: RunContext,
): BatchResult | null {
  const env = PunchEnvelope.safeParse(raw);
  if (!env.success) return null;
  const byId = new Map(insights.map((i) => [i.id, i]));
  const { canaries, leakIndex } = ctx.deps;
  const leaks = (text: string | undefined) =>
    text != null &&
    (hasCanary(text, canaries ?? defaultCanaries()) ||
      hasPromptChain(text, leakIndex ?? defaultLeakIndex()));
  const checkCtx = { level: ctx.level, canaries, leakIndex };
  const localSeen = new Set(seen);
  const perInsight = new Map<string, number>();
  const result: BatchResult = { accepted: [], dropped: [], drops: {} };

  const drop = (insightId: string, reason: Layer4Code, p: Partial<ValidPunch> | null) => {
    bump(result.drops, reason);
    const entry = newComedyEntry({
      round,
      insightId,
      structure: p?.structure,
      emoji: p?.emoji,
      // Кусок нашего промпта в БД не кладём: кандидата с утечкой храним без текста.
      text: reason === "prompt_leak" || leaks(p?.text) ? null : p?.text,
    });
    result.dropped.push({ ...entry, outcome: "dropped_layer4", reason });
  };

  for (const raw of env.data.punches) {
    const v = validatePunch(raw, byId);
    if (!v.ok) {
      const loose = loosePunch(raw);
      const id =
        raw && typeof raw === "object" && "insightId" in raw
          ? sanitizeText(String(raw.insightId)) || "?"
          : "?";
      drop(id, v.reason, loose);
      continue;
    }
    const p = v.value;
    // Лишние сверх трёх на инсайт молча отбрасываются (как в `write`).
    if ((perInsight.get(p.insightId) ?? 0) >= PUNCHES_PER_INSIGHT) continue;
    const reason = checkOutputText(p.text, checkCtx);
    if (reason) {
      drop(p.insightId, reason, p);
      continue;
    }
    if (overlapsForbidden(p.text, ctx.dossierForbidden)) {
      drop(p.insightId, "avoid_topic", p);
      continue;
    }
    const key = normalizeForDedupe(p.text);
    if (localSeen.has(key)) {
      drop(p.insightId, "duplicate", p);
      continue;
    }
    localSeen.add(key);
    perInsight.set(p.insightId, (perInsight.get(p.insightId) ?? 0) + 1);
    result.accepted.push({
      ...p,
      round,
      key,
      entry: newComedyEntry({ round, ...p }),
      scores: null,
      total: null,
      dupOf: null,
    });
  }
  return result;
}

async function punchBatch(
  insights: readonly Insight[],
  alreadyWritten: readonly string[],
  seen: Set<string>,
  round: number,
  ctx: RunContext,
): Promise<Candidate[]> {
  return withRetries(
    "генератор",
    ({ retryNote }) =>
      buildPunchPrompt({
        profile: ctx.profile,
        insights,
        mode: ctx.mode,
        forbidden: ctx.forbidden,
        alreadyWritten,
        perInsight: PUNCHES_PER_INSIGHT,
        retryNote,
      }),
    ctx.deps.punch,
    (raw) => {
      const r = parseBatch(raw, insights, seen, round, ctx);
      if (!r) return { ok: false, note: "ответ не по схеме: нужен объект punches" };
      if (r.accepted.length === 0) {
        return {
          ok: false,
          note: `ни одна шутка не принята: русский язык, до ${PUNCH_MAX_CHARS} знаков, без длинного тире, insightId как во входе`,
        };
      }
      // Принятое запоминаем только при успехе попытки: неудачная не должна занять тексты.
      for (const c of r.accepted) seen.add(c.key);
      for (const e of r.dropped) ctx.rec.add(e);
      for (const c of r.accepted) ctx.rec.add(c.entry);
      ctx.counters.written += r.accepted.length;
      ctx.counters.droppedInvalid += totalCount(r.drops);
      mergeCounts(ctx.counters.filters.layer4, r.drops);
      return { ok: true, value: r.accepted };
    },
  );
}

/** Все инсайты раунда пачками по `PUNCH_INSIGHTS_PER_CALL`, пачки параллельно. */
export async function writePunches(
  insights: readonly Insight[],
  alreadyWritten: readonly string[],
  seen: Set<string>,
  round: number,
  ctx: RunContext,
): Promise<Candidate[]> {
  const parts = await settleBatches(
    "генератор",
    chunk(insights, PUNCH_INSIGHTS_PER_CALL).map((part) =>
      punchBatch(part, alreadyWritten, seen, round, ctx),
    ),
  );
  return parts.flat();
}
