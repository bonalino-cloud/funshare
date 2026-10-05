import { afterEach, describe, expect, it, vi } from "vitest";
import { createApifyFetcher, ScrapeTransportError } from "./apify";

afterEach(() => vi.unstubAllEnvs());

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 201 });

describe("createApifyFetcher", () => {
  it("POST на run-sync с таймаутом актора 40 с, токен в заголовке, не в URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok([{ username: "a" }]));
    const result = await createApifyFetcher({ token: "tok_test", fetchImpl })("test.user");

    expect(result).toEqual([{ username: "a" }]);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?timeout=40",
    );
    expect(String(url)).not.toContain("tok_test");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok_test");
    expect(JSON.parse(String(init?.body))).toEqual({ usernames: ["test.user"] });
  });

  it.each([500, 502, 408, 429])("%i → ретраибельная ошибка", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("x", { status }));
    await expect(createApifyFetcher({ token: "t", fetchImpl })("a")).rejects.toMatchObject({
      retryable: true,
    });
  });

  it.each([401, 402, 403, 404])("%i → без ретрая", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("x", { status }));
    await expect(createApifyFetcher({ token: "t", fetchImpl })("a")).rejects.toMatchObject({
      retryable: false,
    });
  });

  it("таймаут (AbortSignal) → ретраибельная ошибка", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const promise = createApifyFetcher({ token: "t", fetchImpl, abortAfterMs: 20 })("a");
    await expect(promise).rejects.toBeInstanceOf(ScrapeTransportError);
    await expect(promise).rejects.toMatchObject({ retryable: true });
  });

  it("не JSON → ретраибельная ошибка", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 }));
    await expect(createApifyFetcher({ token: "t", fetchImpl })("a")).rejects.toMatchObject({
      retryable: true,
    });
  });

  it("нет APIFY_TOKEN → понятная неретраибельная ошибка без обращения к сети", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(createApifyFetcher({ fetchImpl })("a")).rejects.toMatchObject({
      message: "APIFY_TOKEN не задан",
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
