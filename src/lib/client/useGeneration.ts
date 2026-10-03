import { useCallback, useEffect, useState } from "react";
import type { ErrorCode, GenerationStatus } from "@/contracts";
import { api, toErrorCode } from "./api";
import { pollUntil } from "./poll";

/** Статусы, на которых поллинг останавливается: пауза на выбор шуток или конец */
const STOP: ReadonlySet<GenerationStatus["status"]> = new Set([
  "awaiting_selection",
  "ready",
  "failed",
]);

/**
 * Статус генерации раз в 2 с. На `awaiting_selection` поллинг замирает, пока экран выбора
 * не вызовет `resume()` после отправки выбора. `startedAt` — для строки «дольше обычного».
 */
export function useGeneration(id: string) {
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [round, setRound] = useState(0);
  const [startedAt] = useState(() => Date.now());

  useEffect(() => {
    const ac = new AbortController();
    pollUntil(
      () => api.getGeneration(id),
      (s) => STOP.has(s.status),
      {
        signal: ac.signal,
        onTick: setStatus,
      },
    ).catch((e: unknown) => {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(toErrorCode(e));
    });
    return () => ac.abort();
  }, [id, round]);

  const resume = useCallback(() => {
    setError(null);
    setRound((n) => n + 1);
  }, []);

  return { status, error, resume, startedAt };
}
