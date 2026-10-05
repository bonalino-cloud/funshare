import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileCheckCreated, ProfileCheckStatus } from "@/contracts";
import { CostMeter } from "../cost";
import { RESULT_CACHE_TTL_MS, STALE_AFTER_MS } from "./config";
import { clientIp, createProfileCheck, getProfileCheck } from "./handlers";
import {
  EXPECTED_PROFILE,
  get,
  makeHandlerDeps,
  NOW,
  okScrape,
  ownerHash,
  OTHER_TOKEN,
  post,
  TOKEN,
} from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const URL_BODY = { instagramUrl: "https://www.instagram.com/Anya.Travels/" };

type T = ReturnType<typeof makeHandlerDeps>;

/** POST → id. */
async function create(t: T, token = TOKEN) {
  const res = await createProfileCheck(post(URL_BODY, { token }), t.deps);
  expect(res.status).toBe(202);
  return ProfileCheckCreated.parse(await res.json()).id;
}
/** GET тем же (или другим) владельцем. */
async function status(t: T, id: string, token = TOKEN) {
  const res = await getProfileCheck(get(id, token), id, t.deps);
  return { res, body: (await res.json()) as unknown };
}

describe("POST: разбор ввода", () => {
  it.each([
    ["не JSON", "{oops"],
    ["нет поля", {}],
    ["пустая строка", { instagramUrl: "  " }],
    ["не строка", { instagramUrl: 5 }],
    ["слишком длинная", { instagramUrl: "a".repeat(301) }],
    ["мусор вместо ника", { instagramUrl: "https://evil.com/x" }],
  ])("%s → 400 invalid_url, ни лимита, ни БД, ни фона", async (_name, body) => {
    const t = makeHandlerDeps();
    const res = await createProfileCheck(post(body), t.deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errorCode: "invalid_url" });
    expect(t.check).not.toHaveBeenCalled();
    expect(t.repo.insert).not.toHaveBeenCalled();
    expect(t.tasks).toHaveLength(0);
  });

  it.each(["anya.travels", "@Anya.Travels", "https://instagram.com/anya.travels/?igsh=1"])(
    "%s → ник anya.travels",
    async (instagramUrl) => {
      const t = makeHandlerDeps();
      await createProfileCheck(post({ instagramUrl }), t.deps);
      expect(t.repo.insert.mock.calls[0]?.[0]).toMatchObject({ igUsername: "anya.travels" });
    },
  );
});

describe("POST: успех checking → ok", () => {
  it("отдаёт {id}, ставит cookie и запускает фон один раз", async () => {
    const t = makeHandlerDeps();
    const res = await createProfileCheck(post(URL_BODY), t.deps);
    expect(res.status).toBe(202);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { id } = ProfileCheckCreated.parse(await res.json());
    expect(t.tasks).toHaveLength(1);
    expect(t.scrape).not.toHaveBeenCalled(); // работа идёт после ответа
    expect(t.rows.get(id)?.status).toBe("checking");
    expect(t.rows.get(id)?.hint).toBe("Открываем профиль…");
  });

  it("поллинг: checking с hint, затем ok с профилем по контракту", async () => {
    const t = makeHandlerDeps();
    const id = await create(t);

    const before = await status(t, id);
    expect(ProfileCheckStatus.parse(before.body)).toMatchObject({
      status: "checking",
      hint: "Открываем профиль…",
    });

    await t.flush();
    const scraped = okScrape();
    expect(t.scrape).toHaveBeenCalledExactlyOnceWith("anya.travels", expect.any(CostMeter));
    expect(t.analyze).toHaveBeenCalledExactlyOnceWith(
      { snapshotId: "snap-1", snapshot: scraped.ok ? scraped.snapshot : undefined },
      expect.any(CostMeter),
    );

    const after = await status(t, id);
    expect(after.res.status).toBe(200);
    expect(ProfileCheckStatus.parse(after.body)).toMatchObject({
      id,
      status: "ok",
      profile: EXPECTED_PROFILE,
    });
    expect(after.body).not.toHaveProperty("hint");
    expect(t.rows.get(id)?.snapshotId).toBe("snap-1");
  });

  it("в ответ не попадают сырые данные профиля", async () => {
    const t = makeHandlerDeps();
    const id = await create(t);
    await t.flush();
    const { body } = await status(t, id);
    expect(JSON.stringify(body)).not.toMatch(/biography|caption|"posts"|reason|stack/i);
  });
});

describe("POST: гардрейлы → failed + errorCode", () => {
  it.each(["profile_not_found", "profile_private", "not_enough_data", "internal"] as const)(
    "scrape: %s — analyze (платный) не запускается",
    async (errorCode) => {
      const t = makeHandlerDeps();
      t.scrape.mockResolvedValue({ ok: false, errorCode });
      const id = await create(t);
      await t.flush();
      expect(t.analyze).not.toHaveBeenCalled();
      const { body } = await status(t, id);
      expect(ProfileCheckStatus.parse(body)).toMatchObject({ status: "failed", errorCode });
      expect(body).not.toHaveProperty("profile");
    },
  );

  it.each(["profile_private", "minor_detected", "not_enough_data", "internal"] as const)(
    "analyze: %s",
    async (errorCode) => {
      const t = makeHandlerDeps();
      t.analyze.mockResolvedValue({ ok: false, errorCode });
      const id = await create(t);
      await t.flush();
      const { body } = await status(t, id);
      expect(ProfileCheckStatus.parse(body)).toMatchObject({ status: "failed", errorCode });
    },
  );

  it("исключение в фоне → failed/internal, а не вечный checking", async () => {
    const t = makeHandlerDeps();
    t.scrape.mockRejectedValue(new Error("boom: secret details"));
    const id = await create(t);
    await t.flush();
    const { body } = await status(t, id);
    expect(ProfileCheckStatus.parse(body)).toMatchObject({
      status: "failed",
      errorCode: "internal",
    });
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});

describe("POST: кэш 24 ч", () => {
  it("второй POST того же ника: ok сразу, scrape и analyze не зовутся", async () => {
    const t = makeHandlerDeps();
    await create(t);
    await t.flush();
    t.scrape.mockClear();
    t.analyze.mockClear();

    const second = await create(t, OTHER_TOKEN);
    expect(t.tasks).toHaveLength(0);
    const { body } = await status(t, second, OTHER_TOKEN);
    expect(ProfileCheckStatus.parse(body)).toMatchObject({
      status: "ok",
      profile: EXPECTED_PROFILE,
    });
    expect(t.scrape).not.toHaveBeenCalled();
    expect(t.analyze).not.toHaveBeenCalled();
    expect(t.rows.get(second)?.snapshotId).toBe("snap-1");
  });

  it("копия принадлежит новому владельцу: первый владелец её не видит", async () => {
    const t = makeHandlerDeps();
    const first = await create(t);
    await t.flush();
    const second = await create(t, OTHER_TOKEN);
    expect(second).not.toBe(first);
    expect((await status(t, second, TOKEN)).res.status).toBe(404);
  });

  it("запрос ищет кэш по окну 24 ч", async () => {
    const t = makeHandlerDeps();
    await create(t);
    const since = t.repo.findCached.mock.calls[0]?.[1];
    expect(NOW.getTime() - (since?.getTime() ?? 0)).toBe(RESULT_CACHE_TTL_MS);
  });

  it("кэш не продлевает сам себя: копия наследует checkedAt источника", async () => {
    const t = makeHandlerDeps();
    const first = await create(t);
    await t.flush();
    const sourceAt = t.rows.get(first)?.checkedAt;
    const copy = await create(t, OTHER_TOKEN);
    expect(t.rows.get(copy)?.checkedAt).toEqual(sourceAt);
  });

  it("отказ minor_detected кэшируется: повтор не платит модели", async () => {
    const t = makeHandlerDeps();
    t.analyze.mockResolvedValue({ ok: false, errorCode: "minor_detected" });
    await create(t);
    await t.flush();
    t.scrape.mockClear();
    t.analyze.mockClear();

    const second = await create(t, OTHER_TOKEN);
    expect(t.tasks).toHaveLength(0);
    const { body } = await status(t, second, OTHER_TOKEN);
    expect(ProfileCheckStatus.parse(body)).toMatchObject({
      status: "failed",
      errorCode: "minor_detected",
    });
    expect(t.scrape).not.toHaveBeenCalled();
    expect(t.analyze).not.toHaveBeenCalled();
  });

  it("другие отказы и internal не кэшируются: повтор запускает работу заново", async () => {
    for (const errorCode of ["internal", "profile_private", "not_enough_data"] as const) {
      const t = makeHandlerDeps();
      t.scrape.mockResolvedValueOnce({ ok: false, errorCode });
      await create(t);
      await t.flush();
      await create(t, OTHER_TOKEN);
      expect(t.tasks).toHaveLength(1);
    }
  });

  it("битый профиль в кэше → промах, проверка идёт заново", async () => {
    const t = makeHandlerDeps();
    const first = await create(t);
    await t.flush();
    const row = t.rows.get(first);
    if (row) t.rows.set(first, { ...row, profile: { garbage: true } });
    await create(t, OTHER_TOKEN);
    expect(t.tasks).toHaveLength(1);
  });
});

describe("POST: лимиты", () => {
  it("лимит исчерпан → 429 rate_limited, дальше ничего не происходит", async () => {
    const t = makeHandlerDeps();
    t.check.mockResolvedValue(false);
    const res = await createProfileCheck(post(URL_BODY), t.deps);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ errorCode: "rate_limited" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(t.repo.findCached).not.toHaveBeenCalled();
    expect(t.repo.insert).not.toHaveBeenCalled();
    expect(t.tasks).toHaveLength(0);
  });

  it("лимитер получает только хэши; токен владельца — если cookie есть", async () => {
    const t = makeHandlerDeps();
    await createProfileCheck(post(URL_BODY, { ip: "203.0.113.7" }), t.deps);
    await createProfileCheck(post(URL_BODY, { ip: "203.0.113.7", token: TOKEN }), t.deps);
    const [anon, known] = t.check.mock.calls.map((c) => c[0]);
    expect(anon?.ownerHash).toBeNull();
    expect(known?.ownerHash).toBe(ownerHash(TOKEN));
    expect(JSON.stringify(t.check.mock.calls)).not.toContain("203.0.113.7");
    expect(JSON.stringify(t.check.mock.calls)).not.toContain(TOKEN);
  });

  it("лимитер недоступен (нет Redis в production, сбой сети) → 503, проверка не стартует", async () => {
    const t = makeHandlerDeps();
    t.check.mockRejectedValue(new Error("redis down"));
    const res = await createProfileCheck(post(URL_BODY), t.deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ errorCode: "internal" });
    expect(t.repo.insert).not.toHaveBeenCalled();
    expect(t.tasks).toHaveLength(0);
  });

  it("БД недоступна → 500 internal без деталей", async () => {
    const t = makeHandlerDeps();
    t.repo.findCached.mockRejectedValue(new Error("password=secret"));
    const res = await createProfileCheck(post(URL_BODY), t.deps);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("clientIp", () => {
  it("x-real-ip приоритетнее", () => {
    const h = new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" });
    expect(clientIp(h)).toBe("1.1.1.1");
  });
  it("из x-forwarded-for берёт последний (добавлен доверенным прокси), а не подделанный первый", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 3.3.3.3" }))).toBe("3.3.3.3");
  });
  it("без заголовков — общий ключ unknown", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
  it("IPv6 из одной сети /64 — один ключ лимита", () => {
    const ip = (v: string) => clientIp(new Headers({ "x-real-ip": v }));
    expect(ip("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ip("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(ip("2001:db8:1:3::1")).not.toBe(ip("2001:db8:1:2::1"));
    expect(ip("::1")).toBe("0:0:0:0::/64");
    expect(ip("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
  it("нераспознанный IPv6 не роняет запрос: ключ — как есть", () => {
    expect(clientIp(new Headers({ "x-real-ip": "1::2::3" }))).toBe("1::2::3");
  });
});

describe("POST: production без HASH_SALT", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("→ 503, хэш с публичной запасной солью не пишется в БД", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HASH_SALT", "");
    const t = makeHandlerDeps();
    const res = await createProfileCheck(post(URL_BODY), t.deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ errorCode: "internal" });
    expect(t.check).not.toHaveBeenCalled();
    expect(t.repo.insert).not.toHaveBeenCalled();
  });
});

describe("cookie ownerToken", () => {
  it("нет cookie → httpOnly, Secure, SameSite=Lax, случайный токен", async () => {
    const t = makeHandlerDeps();
    const a = await createProfileCheck(post(URL_BODY), t.deps);
    const b = await createProfileCheck(post(URL_BODY), t.deps);
    const [ca, cb] = [a, b].map((r) => r.headers.get("set-cookie") ?? "");
    expect(ca).toMatch(/^ownerToken=[A-Za-z0-9_-]{43}; /);
    expect(ca).toMatch(/HttpOnly/);
    expect(ca).toMatch(/Secure/);
    expect(ca).toMatch(/SameSite=Lax/);
    expect(ca).toMatch(/Path=\//);
    expect(ca.split(";")[0]).not.toBe(cb.split(";")[0]);
  });

  it("вне production Secure не ставим (http://localhost)", async () => {
    const t = makeHandlerDeps({ secureCookie: false });
    const res = await createProfileCheck(post(URL_BODY), t.deps);
    expect(res.headers.get("set-cookie")).not.toMatch(/Secure/);
  });

  it("токен уже есть → cookie не перевыпускаем", async () => {
    const t = makeHandlerDeps();
    const res = await createProfileCheck(post(URL_BODY, { token: TOKEN }), t.deps);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("подделанная cookie (не 43 символа base64url) заменяется новой", async () => {
    const t = makeHandlerDeps();
    const res = await createProfileCheck(post(URL_BODY, { token: "admin" }), t.deps);
    expect(res.headers.get("set-cookie")).toMatch(/^ownerToken=[A-Za-z0-9_-]{43}/);
  });

  it("в БД лежит хэш токена, а не сам токен", async () => {
    const t = makeHandlerDeps();
    const id = await create(t);
    expect(t.rows.get(id)?.ownerTokenHash).toBe(ownerHash(TOKEN));
    expect(JSON.stringify(t.repo.insert.mock.calls)).not.toContain(TOKEN);
  });
});

describe("GET: доступ", () => {
  it("чужой токен, без cookie, мусорная cookie, чужой и несуществующий id — одинаковый 404", async () => {
    const t = makeHandlerDeps();
    const id = await create(t);
    const attempts: [string, string | undefined][] = [
      [id, OTHER_TOKEN],
      [id, undefined],
      [id, "short"],
      ["00000000-0000-4000-8000-999999999999", TOKEN],
      ["../../etc/passwd", TOKEN],
    ];
    const bodies = new Set<string>();
    for (const [target, token] of attempts) {
      const res = await getProfileCheck(get(target, token), target, t.deps);
      expect(res.status).toBe(404);
      bodies.add(JSON.stringify(await res.json()));
    }
    expect(bodies.size).toBe(1);
  });

  it("владелец видит свою проверку, ответ не кэшируется", async () => {
    const t = makeHandlerDeps();
    const id = await create(t);
    const { res } = await status(t, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET: ответ строго по контракту", () => {
  async function withProfile(profile: unknown) {
    const t = makeHandlerDeps();
    const id = await create(t);
    await t.flush();
    const row = t.rows.get(id);
    if (row) t.rows.set(id, { ...row, profile });
    return { t, id };
  }

  it("avatarUrl не http(s) (jsonb не доверяем) → null", async () => {
    const { t, id } = await withProfile({ ...EXPECTED_PROFILE, avatarUrl: "javascript:alert(1)" });
    const { body } = await status(t, id);
    expect(ProfileCheckStatus.parse(body)).toMatchObject({
      status: "ok",
      profile: { avatarUrl: null },
    });
  });

  it("профиль в БД не по схеме → 500 internal, а не мусор наружу", async () => {
    const { t, id } = await withProfile({ username: "" });
    const res = await getProfileCheck(get(id, TOKEN), id, t.deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ errorCode: "internal" });
  });
});

describe("GET: зависшие проверки", () => {
  it("checking старше STALE_AFTER_MS закрывается как failed/internal", async () => {
    const t = makeHandlerDeps();
    const id = await create(t); // фон не запускали: имитируем убитую функцию
    const later = new Date(NOW.getTime() + STALE_AFTER_MS + 1000);
    const res = await getProfileCheck(get(id, TOKEN), id, { repo: t.repo, now: () => later });
    expect(ProfileCheckStatus.parse(await res.json())).toMatchObject({
      status: "failed",
      errorCode: "internal",
    });
    expect(t.rows.get(id)?.status).toBe("failed");
  });

  it("свежий checking не трогаем", async () => {
    const t = makeHandlerDeps();
    const id = await create(t);
    const later = new Date(NOW.getTime() + STALE_AFTER_MS - 1000);
    const res = await getProfileCheck(get(id, TOKEN), id, { repo: t.repo, now: () => later });
    expect(ProfileCheckStatus.parse(await res.json()).status).toBe("checking");
    expect(t.repo.fail).not.toHaveBeenCalled();
  });

  it("поздний фон не затирает уже закрытую проверку", async () => {
    const t = makeHandlerDeps();
    const id = await create(t);
    const later = new Date(NOW.getTime() + STALE_AFTER_MS + 1000);
    await getProfileCheck(get(id, TOKEN), id, { repo: t.repo, now: () => later });
    await t.flush(); // фон «проснулся» после закрытия
    expect(t.rows.get(id)?.status).toBe("failed");
    expect(t.rows.get(id)?.errorCode).toBe("internal");
  });
});
