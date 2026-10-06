import type { Rejection } from "../write/candidate";
import type { OutputReason } from "./output-check";

// Счётчики вычеркнутого по слоям и причинам (roast-engine §6 «Итог»): метрика качества промпта.
// Только коды и числа: ни текстов шуток, ни данных профиля. Структура JSON-совместима, чтобы
// задача 13 записала её в `generation_traces` как есть.

/** Слой 4: форма/длина/язык/дубль (`write/candidate.ts`), запретные темы из досье и `OutputReason`. */
export type Layer4Code = Rejection | OutputReason | "avoid_topic";

/** Слой 5: провал вопроса модератора или отсутствие вердикта. */
export type Layer5Code =
  "not_behavior" | "forbidden_topic" | "not_friend_safe" | "unclear" | "no_verdict";

export type Counts<K extends string> = Partial<Record<K, number>>;

export type FilterReport = {
  layer4: Counts<Layer4Code>;
  layer5: Counts<Layer5Code>;
  /** Сколько кандидатов отправлено модератору (включая запасных после замен). */
  moderatorChecked: number;
  /** Сколько проходов модерации понадобилось: 1 — замен не было. */
  moderatorPasses: number;
};

export function emptyReport(): FilterReport {
  return { layer4: {}, layer5: {}, moderatorChecked: 0, moderatorPasses: 0 };
}

export function bump<K extends string>(counts: Counts<K>, code: K, n = 1): void {
  counts[code] = (counts[code] ?? 0) + n;
}

export function mergeCounts<K extends string>(into: Counts<K>, from: Counts<K>): void {
  for (const [code, n] of Object.entries(from) as [K, number][]) bump(into, code, n);
}

export function totalCount(counts: Counts<string>): number {
  return Object.values<number | undefined>(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

function formatCounts(counts: Counts<string>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, n]) => `${code}:${n}`);
  return parts.length === 0 ? "-" : parts.join(",");
}

/** Одна строка для лога: только коды и числа. */
export function formatReport(report: FilterReport): string {
  return `l4=${formatCounts(report.layer4)} l5=${formatCounts(report.layer5)} модератор_проверил=${report.moderatorChecked} проходов=${report.moderatorPasses}`;
}
