import { describe, expect, it, vi } from "vitest";
import { ApiError, isTransient } from "./api";
import { pollUntil } from "./poll";

/** Ответы по очереди: значение или ошибка, которую надо бросить. */
function sequence<T>(steps: Array<T | Error>) {
  let i = 0;
  return vi.fn(async () => {
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step as T;
  });
}

const done = (s: string) => s !== "checking";

describe("pollUntil", () => {
  it("поллит, пока не готово, и отдаёт итог", async () => {
    const fetchOnce = sequence(["checking", "checking", "ok"]);
    const onTick = vi.fn();
    await expect(pollUntil(fetchOnce, done, { intervalMs: 1, onTick })).resolves.toBe("ok");
    expect(fetchOnce).toHaveBeenCalledTimes(3);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it("без retries первая ошибка уходит наружу", async () => {
    const fetchOnce = sequence<string>([new TypeError("Failed to fetch"), "ok"]);
    await expect(pollUntil(fetchOnce, done, { intervalMs: 1 })).rejects.toThrow(TypeError);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });

  it("переживает обрыв сети в пределах retries", async () => {
    const offline = new TypeError("Failed to fetch");
    const fetchOnce = sequence(["checking", offline, offline, "ok"]);
    await expect(
      pollUntil(fetchOnce, done, { intervalMs: 1, retries: 2, isRetryable: isTransient }),
    ).resolves.toBe("ok");
  });

  it("счётчик ошибок сбрасывается после удачного ответа", async () => {
    const offline = new TypeError("Failed to fetch");
    const fetchOnce = sequence([offline, "checking", offline, "checking", "ok"]);
    await expect(pollUntil(fetchOnce, done, { intervalMs: 1, retries: 1 })).resolves.toBe("ok");
  });

  it("ошибок подряд больше retries — сдаётся", async () => {
    const offline = new TypeError("Failed to fetch");
    const fetchOnce = sequence<string>([offline, offline, offline, "ok"]);
    await expect(
      pollUntil(fetchOnce, done, { intervalMs: 1, retries: 2, isRetryable: isTransient }),
    ).rejects.toThrow(TypeError);
    expect(fetchOnce).toHaveBeenCalledTimes(3);
  });

  it("не повторяет то, что isRetryable не пропускает", async () => {
    const fetchOnce = sequence<string>([new ApiError("internal", 404), "ok"]);
    await expect(
      pollUntil(fetchOnce, done, { intervalMs: 1, retries: 5, isRetryable: isTransient }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });

  it("отмена через signal прерывает ожидание", async () => {
    const ac = new AbortController();
    const fetchOnce = sequence(["checking"]);
    const run = pollUntil(fetchOnce, done, { intervalMs: 10_000, signal: ac.signal });
    await vi.waitFor(() => expect(fetchOnce).toHaveBeenCalledTimes(1));
    ac.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("isTransient", () => {
  it.each([
    ["обрыв сети", new TypeError("Failed to fetch"), true],
    ["5xx", new ApiError("internal", 503), true],
    ["404 (чужая или потерянная проверка)", new ApiError("internal", 404), false],
    ["429", new ApiError("rate_limited", 429), false],
    ["ответ не по контракту", new Error("zod"), false],
  ])("%s → %s", (_, error, expected) => {
    expect(isTransient(error)).toBe(expected);
  });
});
