import { describe, expect, it, vi } from "vitest";
import type { GenerationStatus } from "@/contracts";
import { ApiError } from "./api";
import { GENERATION_POLL_RETRIES, pollGeneration } from "./generationPoll";

const at = "2026-10-05T12:00:00.000Z";

function status(code: GenerationStatus["status"]): GenerationStatus {
  if (code === "failed") return { id: "g1", status: code, errorCode: "internal", updatedAt: at };
  if (code === "ready") return { id: "g1", status: code, artifactSlug: "abc", updatedAt: at };
  return { id: "g1", status: code, updatedAt: at };
}

/** Ответы по очереди: статус или ошибка, которую надо бросить. */
function sequence(steps: Array<GenerationStatus | Error>) {
  let i = 0;
  return vi.fn(async () => {
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step as GenerationStatus;
  });
}

const fast = { intervalMs: 1 };

describe("pollGeneration", () => {
  it.each(["awaiting_selection", "ready", "failed"] as const)(
    "останавливается на %s",
    async (code) => {
      const getStatus = sequence([status("queued"), status("writing"), status(code)]);
      const result = await pollGeneration(getStatus, fast);
      expect(result.status).toBe(code);
      expect(getStatus).toHaveBeenCalledTimes(3);
    },
  );

  it("после отправки выбора не останавливается на awaiting_selection: сервер меняет статус позже 202", async () => {
    const getStatus = sequence([
      status("awaiting_selection"),
      status("awaiting_selection"),
      status("drawing"),
      status("ready"),
    ]);
    const result = await pollGeneration(getStatus, { ...fast, selectionSent: true });
    expect(result.status).toBe("ready");
    expect(getStatus).toHaveBeenCalledTimes(4);
  });

  it("не останавливается на queued, writing и drawing", async () => {
    const getStatus = sequence([
      status("queued"),
      status("writing"),
      status("drawing"),
      status("ready"),
    ]);
    await pollGeneration(getStatus, fast);
    expect(getStatus).toHaveBeenCalledTimes(4);
  });

  it("отдаёт каждый ответ в onTick", async () => {
    const onTick = vi.fn();
    await pollGeneration(sequence([status("writing"), status("ready")]), { ...fast, onTick });
    expect(onTick.mock.calls.map(([s]) => s.status)).toEqual(["writing", "ready"]);
  });

  it("переживает обрывы сети подряд в пределах лимита", async () => {
    const offline = new TypeError("Failed to fetch");
    const drops = Array.from({ length: GENERATION_POLL_RETRIES }, () => offline);
    const getStatus = sequence([status("writing"), ...drops, status("ready")]);
    await expect(pollGeneration(getStatus, fast)).resolves.toMatchObject({ status: "ready" });
  });

  it("переживает 5xx сервера", async () => {
    const getStatus = sequence([new ApiError("internal", 503), status("ready")]);
    await expect(pollGeneration(getStatus, fast)).resolves.toMatchObject({ status: "ready" });
  });

  it("сдаётся, когда обрывов подряд больше лимита", async () => {
    const offline = new TypeError("Failed to fetch");
    const getStatus = sequence([offline]);
    await expect(pollGeneration(getStatus, fast)).rejects.toThrow(TypeError);
    expect(getStatus).toHaveBeenCalledTimes(GENERATION_POLL_RETRIES + 1);
  });

  it("404 (чужая ссылка, потерянная cookie) не повторяет", async () => {
    const getStatus = sequence([new ApiError("internal", 404), status("ready")]);
    await expect(pollGeneration(getStatus, fast)).rejects.toBeInstanceOf(ApiError);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("отмена через signal прерывает ожидание", async () => {
    const ac = new AbortController();
    const getStatus = sequence([status("writing")]);
    const run = pollGeneration(getStatus, { intervalMs: 10_000, signal: ac.signal });
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
    ac.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([429, 409])("%i не повторяет", async (httpStatus) => {
    const getStatus = sequence([new ApiError("rate_limited", httpStatus), status("ready")]);
    await expect(pollGeneration(getStatus, fast)).rejects.toBeInstanceOf(ApiError);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("5xx сверх лимита выходит наружу как ApiError", async () => {
    const getStatus = sequence([new ApiError("internal", 503)]);
    await expect(pollGeneration(getStatus, fast)).rejects.toBeInstanceOf(ApiError);
    expect(getStatus).toHaveBeenCalledTimes(GENERATION_POLL_RETRIES + 1);
  });

  it("счётчик обрывов сбрасывается после удачного ответа", async () => {
    const offline = new TypeError("Failed to fetch");
    const drops = Array.from({ length: GENERATION_POLL_RETRIES }, () => offline);
    const getStatus = sequence([...drops, status("writing"), ...drops, status("ready")]);
    await expect(pollGeneration(getStatus, fast)).resolves.toMatchObject({ status: "ready" });
  });
});
