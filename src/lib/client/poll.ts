function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Поллинг раз в `intervalMs`, пока `isDone` не вернёт true или не отменят через signal.
 * `retries` — сколько неудачных запросов подряд пережить (обрыв сети на телефоне), если
 * `isRetryable` их пропускает; следующая ошибка сверх лимита уходит наружу.
 */
export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  isDone: (value: T) => boolean,
  {
    intervalMs = 2000,
    signal,
    onTick,
    retries = 0,
    isRetryable = () => true,
  }: {
    intervalMs?: number;
    signal?: AbortSignal;
    onTick?: (value: T) => void;
    retries?: number;
    isRetryable?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  let failures = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    let value: T;
    try {
      value = await fetchOnce();
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures > retries || !isRetryable(error)) throw error;
      await sleep(intervalMs, signal);
      continue;
    }
    onTick?.(value);
    if (isDone(value)) return value;
    await sleep(intervalMs, signal);
  }
}
