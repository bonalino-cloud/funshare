import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeProfile } from "../analyze/test-helpers";
import { HINTS } from "./config";
import { runProfileCheck, safeAvatarUrl, toCheckedProfile } from "./run";
import { EXPECTED_PROFILE, makeHandlerDeps, NOW } from "./test-helpers";

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

  it("дедлайн: зависший шаг закрывается как internal", async () => {
    vi.useFakeTimers();
    const t = await setup();
    t.scrape.mockImplementation(() => new Promise(() => {}));
    const done = runProfileCheck(t.id, "anya.travels", { ...t.pipeline, deadlineMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    await done;
    expect(t.rows.get(t.id)).toMatchObject({ status: "failed", errorCode: "internal" });
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
    expect(Object.keys(toCheckedProfile(makeProfile())).sort()).toEqual([
      "avatarUrl",
      "displayName",
      "postsCount",
      "username",
    ]);
  });

  it("пустое имя → ник", () => {
    expect(toCheckedProfile(makeProfile({ fullName: "   " })).displayName).toBe("anya.travels");
  });

  it("имя режется по длине и чистится от телефонов", () => {
    const long = toCheckedProfile(makeProfile({ fullName: `Аня ${"я".repeat(300)}` })).displayName;
    expect([...long].length).toBeLessThanOrEqual(100);
    const phone = toCheckedProfile(makeProfile({ fullName: "Аня +7 912 345-67-89" })).displayName;
    expect(phone).not.toContain("345-67-89");
  });

  it("небезопасный avatarUrl → null", () => {
    expect(toCheckedProfile(makeProfile({ avatarUrl: "data:text/html,x" })).avatarUrl).toBeNull();
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
