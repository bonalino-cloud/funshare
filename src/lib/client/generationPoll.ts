import type { GenerationStatus } from "@/contracts";
import { isTransient } from "./api";
import { pollUntil } from "./poll";

/** Статусы, на которых поллинг останавливается: пауза на выбор шуток или конец. */
const STOP: ReadonlySet<GenerationStatus["status"]> = new Set([
  "awaiting_selection",
  "ready",
  "failed",
]);

/**
 * Сколько неудачных запросов подряд переживаем: до ~10 с без связи (лифт, переключение в
 * Instagram). Конвейер на сервере идёт своим ходом и без нас, ронять экран из-за одного обрыва нельзя.
 */
export const GENERATION_POLL_RETRIES = 5;

/**
 * Статус генерации раз в 2 с до паузы на выбор или конца. Обрыв сети и 5xx — повтор, 4xx — сразу наружу.
 * `selectionSent` — выбор уже отправлен: сервер отвечает 202 раньше, чем меняет статус, поэтому
 * `awaiting_selection` тут больше не пауза, ждём следующий статус.
 */
export function pollGeneration(
  getStatus: () => Promise<GenerationStatus>,
  {
    signal,
    onTick,
    intervalMs,
    selectionSent = false,
  }: {
    signal?: AbortSignal;
    onTick?: (status: GenerationStatus) => void;
    intervalMs?: number;
    selectionSent?: boolean;
  } = {},
): Promise<GenerationStatus> {
  const isDone = (s: GenerationStatus) =>
    STOP.has(s.status) && !(selectionSent && s.status === "awaiting_selection");
  return pollUntil(getStatus, isDone, {
    signal,
    onTick,
    intervalMs,
    retries: GENERATION_POLL_RETRIES,
    isRetryable: isTransient,
  });
}
