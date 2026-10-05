import { useCallback, useEffect, useState } from "react";
import type { GenerationStatus } from "@/contracts";
import { api } from "./api";
import { pollGeneration } from "./generationPoll";
import { recallStartedAt } from "./history";

/** Что сломалось при опросе. Обёртка, чтобы «нет ошибки» не путалось с любым брошенным значением. */
export type GenerationPollError = { readonly cause: unknown };

/**
 * Статус генерации раз в 2 с. На `awaiting_selection` поллинг замирает, пока экран выбора
 * не вызовет `resume()` после отправки выбора, а после ошибки связи `resume()` продолжает опрос
 * той же генерации. `startedAt` — для строки «дольше обычного»: от запуска, а не от открытия
 * страницы, поэтому перезагрузка его не обнуляет.
 */
export function useGeneration(id: string) {
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [error, setError] = useState<GenerationPollError | null>(null);
  const [round, setRound] = useState(0);
  const [startedAt] = useState(() => recallStartedAt(id) ?? Date.now());

  useEffect(() => {
    const ac = new AbortController();
    pollGeneration(() => api.getGeneration(id), { signal: ac.signal, onTick: setStatus }).catch(
      (cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError({ cause });
      },
    );
    return () => ac.abort();
  }, [id, round]);

  const resume = useCallback(() => {
    setError(null);
    setRound((n) => n + 1);
  }, []);

  return { status, error, resume, startedAt };
}
