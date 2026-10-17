import { buildEditorPrompt } from "../prompts/comedy/editor-v1";
import { MIN_CLARITY } from "./config";
import { withRetries, type Parsed } from "./retry";
import { EditorEnvelope, EditorItem, editorTotal } from "./schema";
import type { Candidate, RunContext } from "./state";
import { setEditorScores } from "./trace";

// Шаг 4 (comedy-engine §7.5): редактор оценивает кандидатов раунда и выбирает N. Код поверх
// ответа (§3): только валидные id, не `broken`, `clarity ≥ 2`, не больше M на инсайт; недобор
// добирается по сумме оценок с тем же ограничением, затем без него.

const normId = (s: string) => s.trim().toLowerCase();

type EditorAnswer = { scores: Map<string, EditorItem>; picked: string[] };

export function parseEditor(raw: unknown, own: ReadonlySet<string>): Parsed<EditorAnswer> {
  const env = EditorEnvelope.safeParse(raw);
  if (!env.success) return { ok: false, note: "ответ не по схеме: нужны scores и picked" };
  const scores = new Map<string, EditorItem>();
  for (const item of env.data.scores) {
    const parsed = EditorItem.safeParse(item);
    if (!parsed.success) continue;
    const id = normId(parsed.data.id);
    // Только id этой пачки и первая оценка на id.
    if (own.has(id) && !scores.has(id)) scores.set(id, { ...parsed.data, id });
  }
  if (scores.size === 0) {
    return {
      ok: false,
      note: "ни одной валидной оценки: целые 0–5 по пяти критериям, broken true/false, id как во входе",
    };
  }
  const picked: string[] = [];
  for (const raw of env.data.picked) {
    if (typeof raw !== "string") continue;
    const id = normId(raw);
    if (own.has(id) && !picked.includes(id)) picked.push(id);
  }
  return { ok: true, value: { scores, picked } };
}

export type EditedRound = {
  /** Выбор редактора в порядке силы: только годные кандидаты. */
  picked: Candidate[];
  /** Все годные (оценены, не `broken`, ясность ≥ 2): из них добор. */
  pool: Candidate[];
};

/** Оценки на кандидатов и в трассу; негодные помечаются там же. */
function applyScores(
  ids: readonly { id: string; c: Candidate }[],
  answer: EditorAnswer,
  ctx: RunContext,
): Candidate[] {
  const byId = new Map(ids.map(({ id, c }) => [id, c]));
  const pool: Candidate[] = [];
  for (const { id, c } of ids) {
    const s = answer.scores.get(id);
    if (!s) {
      ctx.counters.unscored++;
      c.entry.outcome = "dropped_editor";
      c.entry.reason = "no_score";
      continue;
    }
    const total = editorTotal(s);
    c.scores = s;
    c.total = total;
    setEditorScores(c.entry, s, total, s.broken);
    const dup = s.duplicateOf ? byId.get(normId(s.duplicateOf)) : undefined;
    c.dupOf = dup && dup !== c ? dup : null;
    if (s.broken || s.clarity < MIN_CLARITY) {
      ctx.counters.droppedByJudge++;
      c.entry.outcome = "dropped_editor";
      c.entry.reason = s.broken ? "broken" : "clarity";
      continue;
    }
    pool.push(c);
  }
  return pool;
}

/** Один вызов редактора на весь раунд: ему нужно видеть всех, чтобы выбрать разные темы. */
export async function editRound(
  candidates: readonly Candidate[],
  need: number,
  cap: number,
  alreadyChosen: readonly string[],
  ctx: RunContext,
): Promise<EditedRound> {
  if (candidates.length === 0 || need <= 0) return { picked: [], pool: [] };
  const ids = candidates.map((c, i) => ({ id: `c${i + 1}`, c }));
  const own = new Set(ids.map(({ id }) => id));
  const answer = await withRetries(
    "редактор",
    ({ retryNote }) =>
      buildEditorPrompt({
        n: Math.min(need, candidates.length),
        m: cap,
        alreadyChosen,
        candidates: ids.map(({ id, c }) => ({
          id,
          insightId: c.insightId,
          structure: c.structure,
          text: c.text,
        })),
        retryNote,
      }),
    ctx.deps.editor,
    (raw) => parseEditor(raw, own),
  );
  const pool = applyScores(ids, answer, ctx);
  const eligible = new Set(pool);
  const byId = new Map(ids.map(({ id, c }) => [id, c]));
  const picked = answer.picked.flatMap((id) => {
    const c = byId.get(id);
    return c && eligible.has(c) ? [c] : [];
  });
  return { picked, pool };
}

/**
 * Кого отдать модератору (§3): сначала выбор редактора, затем добор по сумме оценок с
 * ограничением `cap` на инсайт, затем без него. `taken` (уже одобренные) занимают места
 * в ограничении; повтор уже взятого (`dupOf`) не берётся.
 */
export function pickForOutput(args: {
  picked: readonly Candidate[];
  pool: readonly Candidate[];
  need: number;
  cap: number;
  taken: readonly Candidate[];
}): Candidate[] {
  const out: Candidate[] = [];
  const chosen = new Set(args.taken);
  const perInsight = new Map<string, number>();
  for (const c of args.taken) perInsight.set(c.insightId, (perInsight.get(c.insightId) ?? 0) + 1);

  const canTake = (c: Candidate, withCap: boolean) =>
    !chosen.has(c) &&
    !(c.dupOf !== null && chosen.has(c.dupOf)) &&
    (!withCap || (perInsight.get(c.insightId) ?? 0) < args.cap);
  const take = (c: Candidate) => {
    out.push(c);
    chosen.add(c);
    perInsight.set(c.insightId, (perInsight.get(c.insightId) ?? 0) + 1);
  };
  const fill = (list: readonly Candidate[], withCap: boolean) => {
    for (const c of list) {
      if (out.length >= args.need) return;
      if (canTake(c, withCap)) take(c);
    }
  };

  const byScore = [...args.pool].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  fill(args.picked, true);
  fill(byScore, true);
  fill(byScore, false);
  return out;
}
