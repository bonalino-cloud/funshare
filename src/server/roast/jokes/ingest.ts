import { LABEL_PROMPT_VERSION } from "../../prompts/jokes/label-v1";
import { deriveFlags } from "./card";
import {
  LABEL_BATCH_SIZE,
  LABEL_CONCURRENCY,
  type LabelGenerate,
  type LabelResult,
  labelJokes,
} from "./label";
import { type ParsedJoke, parseJokesMd } from "./parse-md";
import type { CardWrite, ExistingCard } from "./repository";
import { createDupIndex, textHash } from "./text";

// Приём корпуса в банк: парс → дедуп → разметка только нового/изменённого → upsert по source
// (roast-engine.md §5.1). Оффлайн, запускается руками (`pnpm jokes:ingest`), в рантайме не живёт.

export type IngestEntry = { record: ParsedJoke; hash: string; kind: "new" | "changed" };

export type IngestPlan = {
  parsed: number;
  /** Что нужно разметить и записать. */
  entries: IngestEntry[];
  unchanged: number;
  /** Дубль не пишется: `source` копии и `source`/ключ оригинала. Тексты не храним в отчёте. */
  duplicates: { source: string; of: string }[];
  /** Есть в БД, но нет в файле: ничего не удаляем (корпус может быть частичным). */
  missingInSource: string[];
  /** Проблемы парсера (повтор source, пустой текст). */
  issues: string[];
};

/** Чистая часть: сравнение файла с тем, что уже в БД. Без IO и без LLM (её же использует --dry-run). */
export function planIngest(md: string, existing: readonly ExistingCard[]): IngestPlan {
  const { records, issues } = parseJokesMd(md);
  const bySource = new Map(existing.map((c) => [c.source, c]));

  // В индекс сначала кладём всё, что уже в банке, потом принятое из файла: первый встречный
  // остаётся оригиналом. Текст карточки, которая сейчас меняется, в индекс не попадает.
  const incoming = new Map(records.map((r) => [r.source, r]));
  const index = createDupIndex();
  for (const card of existing) {
    const rec = incoming.get(card.source);
    const changing = rec !== undefined && textHash(rec.text, rec.nsfw) !== card.textHash;
    if (!changing) index.add(card.source, card.text);
  }

  const entries: IngestEntry[] = [];
  const duplicates: IngestPlan["duplicates"] = [];
  let unchanged = 0;

  for (const record of records) {
    const hash = textHash(record.text, record.nsfw);
    const known = bySource.get(record.source);
    if (known && known.textHash === hash) {
      unchanged += 1;
      continue;
    }
    const original = index.find(record.text);
    if (original !== null && original !== record.source) {
      duplicates.push({ source: record.source, of: original });
      continue;
    }
    index.add(record.source, record.text);
    entries.push({ record, hash, kind: known ? "changed" : "new" });
  }

  const missingInSource = existing.map((c) => c.source).filter((s) => !incoming.has(s));
  return { parsed: records.length, entries, unchanged, duplicates, missingInSource, issues };
}

export type IngestReport = {
  parsed: number;
  unchanged: number;
  new: number;
  changed: number;
  duplicates: IngestPlan["duplicates"];
  /** Не записаны: ответ модели не прошёл схему или вызов упал (причины без текстов). */
  failed: LabelResult["errors"];
  written: number;
  /** `source` карточек, которых нет в файле: в банке остаются, снять одобрение — через ревью CSV. */
  missingInSource: string[];
  issues: string[];
};

export type IngestDeps = {
  generate: LabelGenerate;
  save: (rows: readonly CardWrite[]) => Promise<void>;
  model: string;
  batchSize?: number;
  concurrency?: number;
};

/** Размечает план и пишет в БД. Невалидная разметка в БД не попадает. */
export async function runIngest(plan: IngestPlan, deps: IngestDeps): Promise<IngestReport> {
  const batchSize = deps.batchSize ?? LABEL_BATCH_SIZE;
  const concurrency = deps.concurrency ?? LABEL_CONCURRENCY;
  // Размечаем и пишем порциями: сбой посреди прогона не теряет уже оплаченную разметку,
  // а повторный запуск доделает только остаток (записанное неизменно по хэшу).
  const chunkSize = batchSize * concurrency;

  const failed: LabelResult["errors"] = [];
  let written = 0;
  for (let i = 0; i < plan.entries.length; i += chunkSize) {
    const chunk = plan.entries.slice(i, i + chunkSize);
    const labeled = await labelJokes(
      chunk.map((e) => ({ key: e.record.source, text: e.record.text })),
      { generate: deps.generate, batchSize, concurrency },
    );
    failed.push(...labeled.errors);

    const rows: CardWrite[] = [];
    for (const { record, hash } of chunk) {
      const label = labeled.labels.get(record.source);
      if (!label) continue;
      rows.push({
        source: record.source,
        section: record.section,
        text: record.text,
        textHash: hash,
        // Красные линии и 🔞 выводит код: разметке модели в этом не доверяем.
        label: deriveFlags(label, record.nsfw),
        labelVersion: LABEL_PROMPT_VERSION,
        labelModel: deps.model,
      });
    }
    if (rows.length > 0) await deps.save(rows);
    written += rows.length;
  }

  return {
    parsed: plan.parsed,
    unchanged: plan.unchanged,
    new: plan.entries.filter((e) => e.kind === "new").length,
    changed: plan.entries.filter((e) => e.kind === "changed").length,
    duplicates: plan.duplicates,
    failed,
    written,
    missingInSource: plan.missingInSource,
    issues: plan.issues,
  };
}
