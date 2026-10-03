/** Поллинг раз в `intervalMs`, пока `isDone` не вернёт true или не отменят через signal. */
export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  isDone: (value: T) => boolean,
  {
    intervalMs = 2000,
    signal,
    onTick,
  }: { intervalMs?: number; signal?: AbortSignal; onTick?: (value: T) => void } = {},
): Promise<T> {
  for (;;) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const value = await fetchOnce();
    onTick?.(value);
    if (isDone(value)) return value;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs);
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
}
