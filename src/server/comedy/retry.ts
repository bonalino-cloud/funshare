import { LlmSchemaError } from "../analyze/llm";
import { WriteFailedError } from "../roast/write/types";
import { MAX_ATTEMPTS } from "./config";
import type { ComedyGenerateFn, ComedyPrompt } from "./types";

// Ретраи и пачки comedy-движка: тот же порядок, что в `write` (write-candidates.ts).

/** В лог — только событие и имя ошибки: ни текста профиля, ни ответа модели, ни ключа. */
export function logComedy(event: string, detail?: unknown): void {
  const name = detail instanceof Error ? detail.name : "";
  console.error(`[comedy] ${event}${name ? `: ${name}` : ""}`);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; note: string };

/** Состояние попыток для сборщика промпта: причина отказа и был ли прошлый сбой вызовом. */
export type AttemptState = { retryNote: string | undefined; callFailed: boolean };

/**
 * Вызов модели с ретраями: сбой вызова или ответ, который `parse` не принял, дают ещё до двух
 * попыток; причина (наш текст) идёт в промпт. Исчерпаны — `llm_failed`. Исключение из `parse`
 * (например, `bad_input` по сигналам несовершеннолетнего) не ретраится и летит дальше.
 */
export async function withRetries<T>(
  label: string,
  prompt: (state: AttemptState) => ComedyPrompt,
  generate: ComedyGenerateFn,
  parse: (raw: unknown) => Parsed<T>,
): Promise<T> {
  let state: AttemptState = { retryNote: undefined, callFailed: false };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: unknown;
    try {
      raw = await generate(prompt(state));
    } catch (error) {
      logComedy(`${label}: попытка ${attempt}: сбой вызова`, error);
      const schemaError = error instanceof LlmSchemaError;
      state = { retryNote: schemaError ? error.message : undefined, callFailed: !schemaError };
      continue;
    }
    const parsed = parse(raw);
    if (parsed.ok) return parsed.value;
    logComedy(`${label}: попытка ${attempt}: ответ не принят`);
    state = { retryNote: parsed.note, callFailed: false };
  }
  throw new WriteFailedError("llm_failed");
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Пачки параллельно. Пачка, исчерпавшая ретраи, отпадает; отпали все — `llm_failed`. Чужая
 * ошибка (баг, `bad_input`) летит как есть.
 */
export async function settleBatches<T>(label: string, tasks: readonly Promise<T>[]): Promise<T[]> {
  if (tasks.length === 0) return [];
  const results = await Promise.allSettled(tasks);
  const ok: T[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") ok.push(r.value);
    else if (!(r.reason instanceof WriteFailedError) || r.reason.reason !== "llm_failed") {
      throw r.reason;
    }
  }
  if (ok.length === 0) throw new WriteFailedError("llm_failed");
  if (ok.length < results.length) {
    logComedy(`${label}: отпало пачек ${results.length - ok.length} из ${results.length}`);
  }
  return ok;
}

/** Причины отказа для ретрая: только пути полей, без значений (в них текст модели). */
export function issuePaths(error: { issues: readonly { path: PropertyKey[] }[] }): string {
  const paths = error.issues.slice(0, 6).map((i) => i.path.map(String).join(".") || "(корень)");
  return [...new Set(paths)].join(", ");
}
