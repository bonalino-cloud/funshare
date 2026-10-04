import { z } from "zod";
import { deriveFlags, JokeHeat, JokeMechanism, JokeSkeleton, JokeTopic } from "./card";
import { CsvFormatError, guardCell, parseCsv, toCsv, unguardCell } from "./csv";
import type { ReviewCard, ReviewUpdate } from "./repository";
import { normalizeText } from "./text";

// Ревью-таблица: экспорт в CSV для Excel и импорт решений обратно (roast-engine.md §5.1 п.4).
// Тексты 18+ лежат в CSV, поэтому по умолчанию он пишется в игнорируемую git папку.

export const REVIEW_COLUMNS = [
  "source",
  "text",
  "mechanism",
  "skeleton",
  "heat",
  "topic",
  "redline",
  "wellDoneOnly",
  "nsfw",
  "approved",
] as const;

const GUARDED = new Set(["text", "skeleton"]);

function sourceOrder(source: string): [number, number] {
  const m = /^s(\d+)#(\d+)$/.exec(source);
  return [Number(m?.[1] ?? 0), Number(m?.[2] ?? 0)];
}

export function exportReviewCsv(
  cards: readonly ReviewCard[],
  opts: { pendingOnly?: boolean } = {},
): string {
  const rows = cards
    .filter((c) => !opts.pendingOnly || !c.approved)
    .toSorted((a, b) => {
      const [as, an] = sourceOrder(a.source);
      const [bs, bn] = sourceOrder(b.source);
      return as - bs || an - bn;
    })
    .map((c) =>
      REVIEW_COLUMNS.map((col) => {
        const value = String(c[col]);
        return GUARDED.has(col) ? guardCell(value) : value;
      }),
    );
  return toCsv([[...REVIEW_COLUMNS], ...rows]);
}

const BoolCell = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v, ctx) => {
    if (["true", "1", "да", "yes", "x"].includes(v)) return true;
    if (["false", "0", "нет", "no"].includes(v)) return false;
    ctx.addIssue({ code: "custom", message: "не булево значение" });
    return z.NEVER;
  });

const Edits = z.object({
  mechanism: JokeMechanism,
  skeleton: JokeSkeleton,
  heat: JokeHeat,
  topic: JokeTopic,
});

export type ReviewImportPlan = {
  updates: ReviewUpdate[];
  /** Строки без изменений (всё как в БД). */
  unchanged: number;
  /** Не применены: `source` и короткая причина (без текстов). */
  rejected: { source: string; reason: string }[];
};

/**
 * Читает решения из CSV. Применяет только `approved` и ручные правки mechanism/skeleton/heat/topic
 * (через ту же схему и `deriveFlags`). Колонки redline/wellDoneOnly/nsfw и text игнорируются:
 * снять красную линию через CSV нельзя. Пустая ячейка `approved` = «не трогать».
 * Строка, где text не совпадает с БД, отклоняется как устаревшая: решение принято по другому тексту.
 */
export function planReviewImport(csv: string, cards: readonly ReviewCard[]): ReviewImportPlan {
  const rows = parseCsv(csv);
  const header = rows[0];
  if (!header) throw new CsvFormatError("CSV пустой");
  const col = new Map(header.map((name, i) => [name.trim(), i]));
  for (const required of ["source", "text", "approved"] as const) {
    if (!col.has(required)) throw new CsvFormatError(`в CSV нет колонки ${required}`);
  }
  const cell = (row: string[], name: string) => row[col.get(name) ?? -1] ?? undefined;

  const bySource = new Map(cards.map((c) => [c.source, c]));
  const plan: ReviewImportPlan = { updates: [], unchanged: 0, rejected: [] };
  const seen = new Set<string>();

  for (const row of rows.slice(1)) {
    const source = (cell(row, "source") ?? "").trim();
    const reject = (reason: string) => plan.rejected.push({ source, reason });
    const card = bySource.get(source);
    if (!card) {
      reject("нет такой карточки");
      continue;
    }
    if (seen.has(source)) {
      reject("повтор строки");
      continue;
    }
    seen.add(source);
    if (normalizeText(unguardCell(cell(row, "text") ?? "")) !== normalizeText(card.text)) {
      reject("текст изменился с экспорта");
      continue;
    }

    const update: ReviewUpdate = { source };
    let invalid: string | null = null;

    const approvedRaw = (cell(row, "approved") ?? "").trim();
    if (approvedRaw !== "") {
      const approved = BoolCell.safeParse(approvedRaw);
      if (approved.success) {
        if (approved.data !== card.approved) update.approved = approved.data;
      } else invalid = "approved";
    }

    const edits = Edits.safeParse({
      mechanism: (cell(row, "mechanism") ?? "").trim() || card.mechanism,
      skeleton: unguardCell(cell(row, "skeleton") ?? "") || card.skeleton,
      heat: (cell(row, "heat") ?? "").trim() || card.heat,
      topic: (cell(row, "topic") ?? "").trim() || card.topic,
    });
    if (!edits.success) invalid ??= edits.error.issues.map((i) => String(i.path[0])).join(",");
    else {
      const changed =
        edits.data.mechanism !== card.mechanism ||
        edits.data.skeleton !== card.skeleton ||
        edits.data.heat !== card.heat ||
        edits.data.topic !== card.topic;
      if (changed) {
        // Флаги только ужесточаются: смена темы на health/family/body/sex включит красную линию.
        const flags = deriveFlags({ ...card, ...edits.data });
        update.label = {
          ...edits.data,
          redline: flags.redline,
          wellDoneOnly: flags.wellDoneOnly,
        };
      }
    }

    if (invalid) reject(`некорректно: ${invalid}`);
    else if (update.approved === undefined && update.label === undefined) plan.unchanged += 1;
    else plan.updates.push(update);
  }
  return plan;
}
