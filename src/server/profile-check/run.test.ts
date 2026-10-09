import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CostRun } from "../cost";
import { makeProfile } from "../analyze/test-helpers";
import { HINTS } from "./config";
import { runProfileCheck, safeAvatarUrl, toCheckedProfile } from "./run";
import {
  EXPECTED_PROFILE,
  makeHandlerDeps,
  NOW,
  OUR_AVATAR_URL,
  okAnalyze as okAnalyzeResult,
  okScrape as okScrapeResult,
} from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const t = makeHandlerDeps();
  const id = await t.repo.insert({
    status: "checking",
    hint: HINTS.scrape,
    igUsername: "anya.travels",
    ownerTokenHash: "o",
    ipHash: "i",
  });
  const pipeline = { ...t.deps.pipeline, repo: t.repo, now: t.deps.now };
  return { ...t, id, pipeline };
}

describe("runProfileCheck", () => {
  describe("учёт стоимости", () => {
    /** Шаги, которые, как настоящие, пишут траты в общий счётчик проверки. */
    async function metered() {
      const t = await setup();
      t.scrape.mockImplementation(async (_u, meter) => {
        meter.recordApify({ results: 1 });
        return okScrapeResult();
      });
      t.analyze.mockImplementation(async (_i, meter) => {
        meter.recordLlm({
          role: "analyze",
          model: "claude-sonnet-5",
          usage: { inputTokens: 20_000, outputTokens: 3_000 },
          ok: true,
        });
        return okAnalyzeResult();
      });
      return t;
    }

    it("успех: траты Apify и анализа уходят в complete и проходят схему", async () => {
      const t = await metered();
      await runProfileCheck(t.id, "anya.travels", t.pipeline);
      const cost = t.repo.complete.mock.calls[0]?.[1].cost;
      const parsed = CostRun.parse(cost);
      expect(parsed.apify).toMatchObject({ attempts: 1, results: 1, source: "estimate" });
      expect(parsed.llm).toHaveLength(1);
      expect(parsed.estimated).toBe(false);
      // 20k вход * $2/M + 3k выход * $10/M = $0.07 + Apify $0.0026
      expect(parsed.microUsd).toBe(70_000 + 2_600);
    });

    it("отказ тоже пишет траты: scrape заплатил, analyze не запускался", async () => {
      const t = await metered();
      t.scrape.mockImplementation(async (_u, meter) => {
        meter.recordApify({ results: 1 });
        return { ok: false, errorCode: "profile_private" };
      });
      await runProfileCheck(t.id, "anya.travels", t.pipeline);
      const cost = t.repo.fail.mock.calls[0]?.[3];
      expect(cost?.apify?.results).toBe(1);
      expect(cost?.llm).toEqual([]);
    });

    it("в лог одна строка с числами, без ника и текстов", async () => {
      const t = await metered();
      await runProfileCheck(t.id, "anya.travels", t.pipeline);
      const lines = vi
        .mocked(console.error)
        .mock.calls.map((c) => c.join(" "))
        .filter((l) => l.startsWith("[cost]"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("центов=");
      expect(lines[0]).not.toContain("anya");
    });

    it("кэш (ничего не потрачено): строки лога нет, в БД нулевой прогон", async () => {
      const t = await setup();
      await runProfileCheck(t.id, "anya.travels", t.pipeline);
      const cost = t.repo.complete.mock.calls[0]?.[1].cost;
      expect(cost?.microUsd).toBe(0);
      const lines = vi
        .mocked(console.error)
        .mock.calls.map((c) => c.join(" "))
        .filter((l) => l.startsWith("[cost]"));
      expect(lines).toHaveLength(0);
    });
  });

  it("hint идёт по шагам человеческими словами", async () => {
    const t = await setup();
    await runProfileCheck(t.id, "anya.travels", t.pipeline);
    expect(t.repo.setHint.mock.calls.map((c) => c[1])).toEqual([HINTS.scrape, HINTS.analyze]);
    for (const hint of Object.values(HINTS)) {
      expect(hint.length).toBeLessThanOrEqual(80);
      expect(hint).not.toMatch(/[a-z_]{4,}/); // без кодов вроде not_enough_data
    }
    expect(t.rows.get(t.id)).toMatchObject({
      status: "ok",
      snapshotId: "snap-1",
      profile: EXPECTED_PROFILE,
      checkedAt: NOW,
      hint: null,
    });
  });

  it("аватар: в копировщик уходит URL из снимка, на экран — наш URL, не Instagram", async () => {
    const t = await setup();
    const snapshot = makeProfile({ avatarUrl: "https://scontent.cdninstagram.com/a.jpg" });
    t.scrape.mockResolvedValue({ ok: true, snapshot, snapshotId: "snap-1", cached: false });
    await runProfileCheck(t.id, "anya.travels", t.pipeline);
    expect(t.copyAvatar).toHaveBeenCalledWith({
      username: "anya.travels",
      url: "https://scontent.cdninstagram.com/a.jpg",
    });
    expect(t.rows.get(t.id)?.profile).toMatchObject({ avatarUrl: OUR_AVATAR_URL });
  });

  it("аватар: копировщик вернул null → проверка ok с avatarUrl null", async () => {
    const t = await setup();
    t.copyAvatar.mockResolvedValue(null);
    await runProfileCheck(t.id, "anya.travels", t.pipeline);
    expect(t.rows.get(t.id)).toMatchObject({ status: "ok", profile: { avatarUrl: null } });
  });

  it("аватар: копировщик бросил → проверка ok, в лог только имя ошибки", async () => {
    const t = await setup();
    const error = new Error("https://scontent.cdninstagram.com/a.jpg anya.travels");
    error.name = "BlobError";
    t.copyAvatar.mockRejectedValue(error);
    await runProfileCheck(t.id, "anya.travels", t.pipeline);
    expect(t.rows.get(t.id)).toMatchObject({ status: "ok", profile: { avatarUrl: null } });
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("BlobError");
    expect(logged).not.toContain("cdninstagram");
    expect(logged).not.toContain("anya.travels");
  });

  it("аватар не копируется, если analyze отказал (закрытый, младше 16)", async () => {
    const t = await setup();
    t.analyze.mockResolvedValue({ ok: false, errorCode: "minor_detected" });
    await runProfileCheck(t.id, "anya.travels", t.pipeline);
    expect(t.copyAvatar).not.toHaveBeenCalled();
  });

  it("дедлайн: зависший шаг закрывается как internal", async () => {
    vi.useFakeTimers();
    const t = await setup();
    t.scrape.mockImplementation(() => new Promise(() => {}));
    const done = runProfileCheck(t.id, "anya.travels", { ...t.pipeline, deadlineMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    await done;
    expect(t.rows.get(t.id)).toMatchObject({ status: "failed", errorCode: "internal" });
  });

  it("дедлайн: траты, дошедшие после закрытия, попадают в лог отдельной строкой", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setup();
    let release: () => void = () => {};
    t.scrape.mockImplementation(async (_u, meter) => {
      meter.recordApify({ results: 1 });
      await new Promise<void>((r) => (release = r));
      return { ok: false, errorCode: "internal" };
    });
    const done = runProfileCheck(t.id, "anya.travels", { ...t.pipeline, deadlineMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    await done;
    expect(t.repo.fail.mock.calls[0]?.[3]?.apify?.results).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    const late = errors.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("[cost] profile-check после дедлайна"));
    expect(late).toHaveLength(1);
  });

  it("не бросает, если не удалось записать результат (закроет GET по STALE)", async () => {
    const t = await setup();
    t.repo.complete.mockRejectedValue(new Error("db down"));
    await expect(runProfileCheck(t.id, "anya.travels", t.pipeline)).resolves.toBeUndefined();
    expect(t.rows.get(t.id)?.status).toBe("checking");
  });

  it("сбой записи hint не ломает проверку", async () => {
    const t = await setup();
    t.repo.setHint.mockRejectedValue(new Error("db blip"));
    await runProfileCheck(t.id, "anya.travels", t.pipeline);
    expect(t.rows.get(t.id)?.status).toBe("ok");
  });

  it("в логи не попадают ник и тексты ошибок", async () => {
    const t = await setup();
    t.scrape.mockRejectedValue(new Error("anya.travels secret-token"));
    await runProfileCheck(t.id, "anya.travels", t.pipeline);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("anya.travels");
    expect(logged).not.toContain("secret-token");
  });
});

describe("toCheckedProfile", () => {
  it("берёт только username, displayName, avatarUrl, postsCount", () => {
    expect(Object.keys(toCheckedProfile(makeProfile(), null)).sort()).toEqual([
      "avatarUrl",
      "displayName",
      "postsCount",
      "username",
    ]);
  });

  it("пустое имя → ник", () => {
    expect(toCheckedProfile(makeProfile({ fullName: "   " }), null).displayName).toBe(
      "anya.travels",
    );
  });

  it("имя режется по длине и чистится от телефонов", () => {
    const long = toCheckedProfile(
      makeProfile({ fullName: `Аня ${"я".repeat(300)}` }),
      null,
    ).displayName;
    expect([...long].length).toBeLessThanOrEqual(100);
    const phone = toCheckedProfile(
      makeProfile({ fullName: "Аня +7 912 345-67-89" }),
      null,
    ).displayName;
    expect(phone).not.toContain("345-67-89");
  });

  it("небезопасная схема avatarUrl → null (защита второго рубежа)", () => {
    expect(toCheckedProfile(makeProfile(), "data:text/html,x").avatarUrl).toBeNull();
  });
});

describe("safeAvatarUrl", () => {
  it.each([
    ["https://cdn.example.com/a.jpg", "https://cdn.example.com/a.jpg"],
    ["http://cdn.example.com/a.jpg", "http://cdn.example.com/a.jpg"],
    ["javascript:alert(1)", null],
    ["data:image/png;base64,AAAA", null],
    ["ftp://x/a.jpg", null],
    ["not a url", null],
    [null, null],
  ])("%j → %j", (input, expected) => expect(safeAvatarUrl(input)).toBe(expected));
});
