import { z } from "zod";
import { buildLabelPrompt } from "../../prompts/jokes/label-v1";
import { JokeLabel } from "./card";

/** Ответ модели на один элемент пакета: разметка плюс id из тега. */
export const LabelItem = JokeLabel.extend({ id: z.number().int() });
export const LabelBatchOutput = z.object({ items: z.array(LabelItem) });

/** Возвращает НЕдоверенный объект: разметчик парсит его сам. Сетевые сбои — исключение. */
export type LabelGenerate = (input: { system: string; user: string }) => Promise<unknown>;

export type LabelInput = { key: string; text: string };
/** Причина без текста шутки и без ответа модели: идёт в отчёт и в логи. */
export type LabelError = { key: string; reason: string };
export type LabelResult = { labels: Map<string, JokeLabel>; errors: LabelError[] };

export const LABEL_BATCH_SIZE = 20;
export const LABEL_CONCURRENCY = 3;

type Deps = { generate: LabelGenerate; batchSize?: number; concurrency?: number };

async function labelBatch(
  batch: readonly LabelInput[],
  generate: LabelGenerate,
): Promise<LabelResult> {
  const labels = new Map<string, JokeLabel>();
  const errors: LabelError[] = [];
  const prompt = buildLabelPrompt(batch.map((item, id) => ({ id, text: item.text })));

  let raw: unknown;
  try {
    raw = await generate(prompt);
  } catch (error) {
    // Только имя класса: тело ошибки провайдера может нести фрагменты промпта.
    const reason = `batch_failed:${error instanceof Error ? error.name : "unknown"}`;
    return { labels, errors: batch.map((item) => ({ key: item.key, reason })) };
  }

  const envelope = z.object({ items: z.array(z.unknown()) }).safeParse(raw);
  if (!envelope.success) {
    return {
      labels,
      errors: batch.map((item) => ({ key: item.key, reason: "invalid_response" })),
    };
  }

  // Каждый элемент проходит схему отдельно: один кривой не роняет остальных.
  const byId = new Map<number, unknown[]>();
  for (const candidate of envelope.data.items) {
    const id = (candidate as { id?: unknown } | null)?.id;
    if (typeof id === "number") byId.set(id, [...(byId.get(id) ?? []), candidate]);
  }
  batch.forEach((item, id) => {
    const found = byId.get(id) ?? [];
    if (found.length === 0) return void errors.push({ key: item.key, reason: "missing" });
    if (found.length > 1) return void errors.push({ key: item.key, reason: "duplicate_id" });
    const parsed = LabelItem.safeParse(found[0]);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))];
      return void errors.push({ key: item.key, reason: `invalid:${fields.join(",")}` });
    }
    const label: JokeLabel & { id?: number } = { ...parsed.data };
    delete label.id;
    labels.set(item.key, label);
  });
  return { labels, errors };
}

/**
 * Размечает шутки пакетами. Невалидный ответ по шутке = запись в `errors`, в `labels` её нет
 * (в БД не пишем). Флаги безопасности здесь НЕ выводятся: это делает `deriveFlags` при записи.
 */
export async function labelJokes(inputs: readonly LabelInput[], deps: Deps): Promise<LabelResult> {
  const size = deps.batchSize ?? LABEL_BATCH_SIZE;
  const batches: LabelInput[][] = [];
  for (let i = 0; i < inputs.length; i += size) batches.push(inputs.slice(i, i + size));

  const results: LabelResult[] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      results[index] = await labelBatch(batches[index]!, deps.generate);
    }
  };
  const workers = Math.max(1, Math.min(deps.concurrency ?? LABEL_CONCURRENCY, batches.length));
  await Promise.all(Array.from({ length: workers }, worker));

  const labels = new Map<string, JokeLabel>();
  const errors: LabelError[] = [];
  for (const r of results) {
    for (const [k, v] of r.labels) labels.set(k, v);
    errors.push(...r.errors);
  }
  return { labels, errors };
}

/** Одна шутка: тот же путь, что у пакета. */
export async function labelJoke(
  text: string,
  generate: LabelGenerate,
): Promise<{ ok: true; label: JokeLabel } | { ok: false; reason: string }> {
  const { labels, errors } = await labelJokes([{ key: "one", text }], { generate });
  const label = labels.get("one");
  return label ? { ok: true, label } : { ok: false, reason: errors[0]?.reason ?? "unknown" };
}
