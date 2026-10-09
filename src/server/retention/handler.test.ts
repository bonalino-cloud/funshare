import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRetention, isAuthorized, secretMatches } from "./handler";
import type { RetentionDeps } from "./run";

const SECRET = "s3cret-value-1234567890";
const env = { CRON_SECRET: SECRET };

function request(authorization?: string) {
  return new Request("https://example.test/api/cron/retention", {
    headers: authorization ? { authorization } : {},
  });
}

function deps(over: Partial<RetentionDeps["db"]> = {}): RetentionDeps {
  const empty = {
    list: vi.fn(async () => ({ blobs: [], hasMore: false })),
    head: vi.fn(async () => null),
    del: vi.fn(async () => {}),
  };
  return {
    db: {
      deleteTraces: vi.fn(async () => 2),
      deleteSnapshots: vi.fn(async () => 1),
      clearAvatarUrls: vi.fn(async () => 0),
      ...over,
    },
    rawStore: () => empty,
    avatarStore: () => empty,
    now: () => new Date("2026-10-09T03:00:00.000Z"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("авторизация", () => {
  it("без заголовка и с неверным секретом — 401 без тела, работа не стартует", async () => {
    const d = deps();
    for (const header of [undefined, "Bearer wrong", `Basic ${SECRET}`, SECRET, "Bearer "]) {
      const res = await handleRetention(request(header), d, env);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
    }
    expect(d.db.deleteTraces).not.toHaveBeenCalled();
  });

  it("CRON_SECRET не задан — 401, в том числе в production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const d = deps();
    expect((await handleRetention(request("Bearer "), d, {})).status).toBe(401);
    expect((await handleRetention(request("Bearer undefined"), d, {})).status).toBe(401);
    const empty = await handleRetention(request(`Bearer ${SECRET}`), d, { CRON_SECRET: "" });
    expect(empty.status).toBe(401);
    const short = await handleRetention(request("Bearer short"), d, { CRON_SECRET: "short" });
    expect(short.status).toBe(401);
    expect(d.db.deleteTraces).not.toHaveBeenCalled();
  });

  it("битое окружение не превращается в 500 до проверки", () => {
    expect(isAuthorized(request(`Bearer ${SECRET}`), { ...env, DATABASE_URL: "not-a-url" })).toBe(
      false,
    );
  });

  it("сравнение секретов не зависит от длины", () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(SECRET + "x", SECRET)).toBe(false);
    expect(secretMatches("", SECRET)).toBe(false);
  });
});

describe("ответ", () => {
  it("верный секрет: 200 с числами и одна строка лога", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await handleRetention(request(`Bearer ${SECRET}`), deps(), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, traces: { deleted: 2 }, snapshots: { deleted: 1 } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/^\[retention\] traces=2 snapshots=1 /);
  });

  it("частичный сбой: 500 с числами, остальные шаги выполнены", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      deleteTraces: async () => {
        throw Object.assign(new Error("secret detail"), { name: "NeonDbError" });
      },
    });
    const res = await handleRetention(request(`Bearer ${SECRET}`), d, env);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      traces: { error: "NeonDbError" },
      snapshots: { deleted: 1 },
    });
    expect(JSON.stringify(body)).not.toContain("secret detail");
    expect(error.mock.calls.flat().join(" ")).not.toContain("secret detail");
  });
});
