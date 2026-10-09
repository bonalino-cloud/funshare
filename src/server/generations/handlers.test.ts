import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationCreated, GenerationStatus, type GenerationRequest } from "@/contracts";
import { GENERATION_COMPUTE_WINDOW_MS } from "../dossier";
import { RESULT_CACHE_TTL_MS } from "../profile-check/config";
import { createGeneration, getGeneration } from "./handlers";
import {
  get,
  makeDeps,
  makePromo,
  NOW,
  ownerHash,
  OTHER_TOKEN,
  post,
  TOKEN,
  URL_BODY,
} from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

type T = ReturnType<typeof makeDeps>;

/** Тело запроса; `profileCheckId` подставляем из настоящей проверки. */
const body = (checkId: string, over: Partial<GenerationRequest> = {}) => ({
  ...URL_BODY,
  profileCheckId: checkId,
  ...over,
});

async function send(t: T, payload: unknown, init: { token?: string; ip?: string } = {}) {
  const res = await createGeneration(post(payload, { token: TOKEN, ...init }), t.deps);
  return { res, json: (await res.json()) as unknown };
}

/** Нет ни генерации, ни заказа: отказ ничего не оставляет. */
function expectNothingWritten(t: T) {
  expect(t.generations.rows.size).toBe(0);
  expect(t.orders.orders).toHaveLength(0);
  expect(t.startWorkflow).not.toHaveBeenCalled();
}

describe("POST: успех", () => {
  it("Поджог, первая проба: 202 {id}, строка queued со всем входом шага write, конвейер запущен", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    const { res, json } = await send(
      t,
      body(checkId, { mode: "friend", level: "rare", extraFacts: ["Любит кофе"] }),
      { ip: "1.2.3.4" },
    );
    expect(res.status).toBe(202);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { id } = GenerationCreated.parse(json);
    expect(id).toBe("gen-1");
    expect(Object.keys(json as object)).toEqual(["id"]);

    const row = t.generations.rows.get(id);
    expect(row).toMatchObject({
      status: "queued",
      igUsername: "anya.travels",
      mode: "friend",
      kind: "roast_v1",
      profileCheckId: checkId,
      tier: 1,
      level: "rare",
      extraFacts: ["Любит кофе"],
      trialGenerationId: null,
      ownerTokenHash: ownerHash(TOKEN),
    });
    // Инвариант 6: ни IP, ни токена в открытом виде.
    expect(JSON.stringify(row)).not.toContain("1.2.3.4");
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(t.orders.orders).toHaveLength(1);
    expect(t.orders.orders[0]).toMatchObject({
      generationId: id,
      status: "free",
      reason: "first_free",
    });
    expect(t.startWorkflow).toHaveBeenCalledExactlyOnceWith(id);
    expect(t.enter).not.toHaveBeenCalled(); // без кода лимит перебора не трогаем
  });

  it("Кострище по верному коду на 100 %: заказ promo_free, запуск, код списан", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() } });
    const checkId = await t.addCheck(TOKEN);
    const { res } = await send(t, body(checkId, { tier: 2, promoCode: "fun-test" }));
    expect(res.status).toBe(202);
    expect(t.orders.orders[0]).toMatchObject({ reason: "promo_free", status: "free" });
    expect(t.orders.codes.get("FUNTEST")?.redeemed).toBe(1);
    expect(t.startWorkflow).toHaveBeenCalledTimes(1);
    expect(t.generations.rows.get("gen-1")?.tier).toBe(2);
    expect(t.fail).not.toHaveBeenCalled(); // верный код не тратит лимит
  });

  it("well_done с ageConfirmed проходит и сохраняет level", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    const { res } = await send(t, body(checkId, { level: "well_done", ageConfirmed: true }));
    expect(res.status).toBe(202);
    expect(t.generations.rows.get("gen-1")?.level).toBe("well_done");
  });
});

describe("POST: разбор тела", () => {
  it.each([
    ["не JSON", "{oops"],
    ["пусто", {}],
    ["well_done без ageConfirmed", { ...URL_BODY, profileCheckId: "x", level: "well_done" }],
    [
      "well_done с ageConfirmed=false",
      { ...URL_BODY, profileCheckId: "x", level: "well_done", ageConfirmed: false },
    ],
    ["чужой тариф", { ...URL_BODY, profileCheckId: "x", tier: 4 }],
    ["6 фактов", { ...URL_BODY, profileCheckId: "x", extraFacts: ["a", "b", "c", "d", "e", "f"] }],
  ])("%s → 400, БД не трогаем", async (_name, payload) => {
    const t = makeDeps();
    await t.addCheck(TOKEN);
    const { res, json } = await send(t, payload);
    expect(res.status).toBe(400);
    expect(json).toEqual({ errorCode: "internal" });
    expect(t.profiles.repo.get).not.toHaveBeenCalled();
    expectNothingWritten(t);
  });

  it("недоступный тариф (Пекло) → 400 без заказа", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    const { res } = await send(t, body(checkId, { tier: 3 }));
    expect(res.status).toBe(400);
    expectNothingWritten(t);
  });
});

describe("POST: проверка профиля и владение", () => {
  it("нет cookie → 404, как чужая проверка", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    const res = await createGeneration(post(body(checkId)), t.deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ errorCode: "internal" });
    expectNothingWritten(t);
  });

  it("подделанная cookie (не тот формат) → 404", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    const { res } = await send(t, body(checkId), { token: "short" });
    expect(res.status).toBe(404);
  });

  it("чужая и несуществующая проверка неотличимы: 404 с одним телом", async () => {
    const t = makeDeps();
    const foreign = await t.addCheck(OTHER_TOKEN);
    const a = await send(t, body(foreign));
    const b = await send(t, body("no-such-id"));
    expect(a.res.status).toBe(404);
    expect(b.res.status).toBe(404);
    expect(a.json).toEqual(b.json);
    expectNothingWritten(t);
  });

  it("проверка ещё идёт (checking) → 409, ничего не пишем", async () => {
    const t = makeDeps();
    const id = await t.profiles.repo.insert({
      igUsername: "anya.travels",
      ownerTokenHash: ownerHash(TOKEN),
      ipHash: "ip",
      status: "checking",
      hint: "…",
    });
    const { res } = await send(t, body(id));
    expect(res.status).toBe(409);
    expectNothingWritten(t);
  });

  it("проверка закончилась отказом → её errorCode (409), генерация не стартует", async () => {
    const t = makeDeps();
    const id = await t.profiles.repo.insert({
      igUsername: "anya.travels",
      ownerTokenHash: ownerHash(TOKEN),
      ipHash: "ip",
      status: "failed",
      errorCode: "minor_detected",
      checkedAt: NOW,
    });
    const { res, json } = await send(t, body(id));
    expect(res.status).toBe(409);
    expect(json).toEqual({ errorCode: "minor_detected" });
    expectNothingWritten(t);
  });

  it("протухшая проверка (старше 24 ч) → 410 profile_not_found; ровно на границе ещё годна", async () => {
    const t = makeDeps();
    const stale = await t.addCheck(TOKEN, {
      checkedAt: new Date(NOW.getTime() - RESULT_CACHE_TTL_MS - 1),
    });
    const { res, json } = await send(t, body(stale));
    expect(res.status).toBe(410);
    expect(json).toEqual({ errorCode: "profile_not_found" });
    expectNothingWritten(t);

    const edge = await t.addCheck(TOKEN, {
      checkedAt: new Date(NOW.getTime() - RESULT_CACHE_TTL_MS),
    });
    expect((await send(t, body(edge))).res.status).toBe(202);
  });
});

describe("POST: досье и гардрейл «младше 16» до заказа", () => {
  it("досье гарантируется по снимку проверки, ожидание задаётся сервером", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    const { res } = await send(t, body(checkId));
    expect(res.status).toBe(202);
    expect(t.ensureDossier).toHaveBeenCalledExactlyOnceWith(
      { snapshotId: "snap-1" },
      1234,
      GENERATION_COMPUTE_WINDOW_MS,
    );
  });

  it("minor_detected → 409, ни заказа, ни пробы, ни кода; аватар чистится", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() } });
    const checkId = await t.addCheck(TOKEN);
    t.ensureDossier.mockResolvedValue({ ok: false, errorCode: "minor_detected" });
    const { res, json } = await send(t, body(checkId, { tier: 2, promoCode: "funtest" }));
    expect(res.status).toBe(409);
    expect(json).toEqual({ errorCode: "minor_detected" });
    expect(t.orders.codes.get("FUNTEST")?.redeemed).toBe(0);
    expect(t.fail).not.toHaveBeenCalled(); // попытка кода не засчитана
    expect(t.onMinor).toHaveBeenCalledExactlyOnceWith({
      igUsername: "anya.travels",
      avatarUrl: "https://abc123.public.blob.vercel-storage.com/avatars/abc",
    });
    expectNothingWritten(t);
  });

  it("Поджог (проба) при minor_detected: проба не расходуется, заказа нет", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    t.ensureDossier.mockResolvedValue({ ok: false, errorCode: "minor_detected" });
    await send(t, body(checkId));
    expect(t.orders.repo.redeemAndCreateOrder).not.toHaveBeenCalled();
    expectNothingWritten(t);
  });

  it.each(["not_enough_data", "profile_private"] as const)("%s → 409 без заказа", async (code) => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    t.ensureDossier.mockResolvedValue({ ok: false, errorCode: code });
    const { res, json } = await send(t, body(checkId));
    expect(res.status).toBe(409);
    expect(json).toEqual({ errorCode: code });
    expect(t.onMinor).not.toHaveBeenCalled();
    expectNothingWritten(t);
  });

  it("досье ещё считается и срок вышел (busy) → 503 internal, ничего не создано", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    t.ensureDossier.mockResolvedValue({ ok: false, errorCode: "internal", busy: true });
    const { res, json } = await send(t, body(checkId));
    expect(res.status).toBe(503);
    expect(json).toEqual({ errorCode: "internal" });
    expectNothingWritten(t);
  });

  it("снимка нет (Cron убрал) → 410 profile_not_found", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    t.ensureDossier.mockResolvedValue({ ok: false, errorCode: "profile_not_found" });
    const { res, json } = await send(t, body(checkId));
    expect(res.status).toBe(410);
    expect(json).toEqual({ errorCode: "profile_not_found" });
    expectNothingWritten(t);
  });

  it("чужая проверка: досье не трогаем вовсе", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(OTHER_TOKEN);
    const { res } = await send(t, body(checkId));
    expect(res.status).toBe(404);
    expect(t.ensureDossier).not.toHaveBeenCalled();
  });
});

describe("POST: заказ", () => {
  it("Кострище без кода → 402 payment_required, нет ни генерации, ни заказа", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    const { res, json } = await send(t, body(checkId, { tier: 2 }));
    expect(res.status).toBe(402);
    expect(json).toEqual({ errorCode: "payment_required" });
    expectNothingWritten(t);
  });

  it("неверный код → 400 promo_invalid, неверная попытка записана в лимит", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() } });
    const checkId = await t.addCheck(TOKEN);
    const { res, json } = await send(t, body(checkId, { tier: 2, promoCode: "nope" }));
    expect(res.status).toBe(400);
    expect(json).toEqual({ errorCode: "promo_invalid" });
    expect(t.fail).toHaveBeenCalledTimes(1);
    expect(t.orders.codes.get("FUNTEST")?.redeemed).toBe(0);
    expectNothingWritten(t);
  });

  it("код на Поджоге с доступной пробой: проба важнее, код не списывается", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo({ tiers: [1, 2] }) } });
    const checkId = await t.addCheck(TOKEN);
    const { res } = await send(t, body(checkId, { tier: 1, promoCode: "funtest" }));
    expect(res.status).toBe(202);
    expect(t.orders.orders).toHaveLength(1);
    expect(t.orders.orders[0]).toMatchObject({ reason: "first_free" });
    expect(t.orders.redemptions).toHaveLength(0);
    expect(t.orders.codes.get("FUNTEST")?.redeemed).toBe(0);
  });

  it("повторный Поджог без кода → 402 payment_required, ничего не записано", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    expect((await send(t, body(checkId))).res.status).toBe(202);
    const { res, json } = await send(t, body(checkId));
    expect(res.status).toBe(402);
    expect(json).toEqual({ errorCode: "payment_required" });
    expect(t.generations.rows.size).toBe(1);
    expect(t.orders.orders).toHaveLength(1);
  });

  it("повторный Поджог по коду на 100 %: стартует, код списан", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo({ tiers: [1, 2] }) } });
    const checkId = await t.addCheck(TOKEN);
    expect((await send(t, body(checkId))).res.status).toBe(202);
    const { res } = await send(t, body(checkId, { tier: 1, promoCode: "funtest" }));
    expect(res.status).toBe(202);
    expect(t.orders.orders.map((o) => o.reason)).toEqual(["first_free", "promo_free"]);
    expect(t.orders.codes.get("FUNTEST")?.redeemed).toBe(1);
  });

  it("пауза на перебор → 429 rate_limited до всякой проверки кода", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() }, guardAllowed: false });
    const checkId = await t.addCheck(TOKEN);
    const { res, json } = await send(t, body(checkId, { tier: 2, promoCode: "funtest" }));
    expect(res.status).toBe(429);
    expect(json).toEqual({ errorCode: "rate_limited" });
    expect(t.orders.repo.findPromo).not.toHaveBeenCalled();
    expectNothingWritten(t);
  });

  it("лимитер недоступен → 503, ничего не пишем", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() } });
    const checkId = await t.addCheck(TOKEN);
    const unavailable = new Error("redis");
    unavailable.name = "RateLimitUnavailableError";
    t.enter.mockRejectedValueOnce(unavailable);
    const { res } = await send(t, body(checkId, { tier: 2, promoCode: "funtest" }));
    expect(res.status).toBe(503);
    expectNothingWritten(t);
  });

  it("вторая проба Поджога на этом устройстве → 402 payment_required, строк не прибавилось", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    expect((await send(t, body(checkId))).res.status).toBe(202);
    const { res, json } = await send(t, body(checkId));
    expect(res.status).toBe(402);
    expect(json).toEqual({ errorCode: "payment_required" });
    expect(t.generations.rows.size).toBe(1);
    expect(t.orders.orders).toHaveLength(1);
    expect(t.startWorkflow).toHaveBeenCalledTimes(1);
  });

  it("двойной клик: два параллельных POST дают одну генерацию, второй payment_required", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    const [a, b] = await Promise.all([send(t, body(checkId)), send(t, body(checkId))]);
    expect([a.res.status, b.res.status].sort()).toEqual([202, 402]);
    expect(t.generations.rows.size).toBe(1);
    expect(t.startWorkflow).toHaveBeenCalledTimes(1);
  });

  it("сбой записи строки после заказа → заказ освобождён, 500 без деталей", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() } });
    const checkId = await t.addCheck(TOKEN);
    t.generations.repo.insert.mockRejectedValueOnce(new Error("connection string leaked"));
    const { res, json } = await send(t, body(checkId, { tier: 2, promoCode: "funtest" }));
    expect(res.status).toBe(500);
    expect(json).toEqual({ errorCode: "internal" });
    expect(JSON.stringify(json)).not.toContain("leaked");
    expect(t.orders.orders[0]?.status).toBe("voided");
    expect(t.orders.codes.get("FUNTEST")?.redeemed).toBe(0);
    expect(t.generations.rows.size).toBe(0);
    expect(t.startWorkflow).not.toHaveBeenCalled();
  });
});

describe("POST: запуск конвейера", () => {
  it("startWorkflow бросил → заказ voided, код освобождён, генерация failed/internal, 503", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() } });
    const checkId = await t.addCheck(TOKEN);
    t.startWorkflow.mockRejectedValueOnce(new Error("secret provider details"));
    const { res, json } = await send(t, body(checkId, { tier: 2, promoCode: "funtest" }));
    expect(res.status).toBe(503);
    expect(json).toEqual({ errorCode: "internal" });
    expect(t.orders.orders[0]?.status).toBe("voided");
    expect(t.orders.codes.get("FUNTEST")?.redeemed).toBe(0);
    expect(t.orders.redemptions[0]?.releasedAt).toEqual(NOW);
    expect(t.generations.rows.get("gen-1")).toMatchObject({
      status: "failed",
      errorCode: "internal",
    });
  });

  it("после сбоя проба Поджога возвращается: следующая попытка проходит", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    t.startWorkflow.mockRejectedValueOnce(new Error("boom"));
    expect((await send(t, body(checkId))).res.status).toBe(503);
    expect((await send(t, body(checkId))).res.status).toBe(202);
  });

  it("сбой освобождения заказа не меняет ответ и не бросает", async () => {
    const t = makeDeps();
    const checkId = await t.addCheck(TOKEN);
    t.startWorkflow.mockRejectedValueOnce(new Error("boom"));
    t.orders.repo.release.mockRejectedValueOnce(new Error("db down"));
    const { res } = await send(t, body(checkId));
    expect(res.status).toBe(503);
    expect(t.generations.rows.get("gen-1")?.status).toBe("failed");
  });
});

describe("POST: trialGenerationId (перенос шуток Поджога)", () => {
  /** Готовый Поджог того же владельца и профиля: свой POST, затем «конвейер» довёл до ready. */
  async function readyTrial(t: T, checkId: string) {
    await send(t, body(checkId));
    const row = t.generations.rows.get("gen-1");
    if (!row) throw new Error("нет Поджога");
    row.status = "ready";
    return row.id;
  }
  const savedTrial = (t: T, id: string) => t.generations.rows.get(id)?.trialGenerationId;

  /** Кострище по коду, потому что проба на устройстве уже потрачена Поджогом. */
  const kostrishche = (t: T, checkId: string, trialGenerationId: string) =>
    send(t, body(checkId, { tier: 2, promoCode: "funtest", trialGenerationId }));

  it("свой готовый Поджог того же профиля — сохраняется", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() } });
    const checkId = await t.addCheck(TOKEN);
    const trialId = await readyTrial(t, checkId);
    expect((await kostrishche(t, checkId, trialId)).res.status).toBe(202);
    expect(savedTrial(t, "gen-2")).toBe(trialId);
  });

  it("чужой Поджог — молча отбрасывается, ответ тот же 202", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() } });
    const otherCheck = await t.addCheck(OTHER_TOKEN);
    await send(t, body(otherCheck), { token: OTHER_TOKEN });
    const foreign = t.generations.rows.get("gen-1");
    if (!foreign) throw new Error("нет чужого Поджога");
    foreign.status = "ready";

    const checkId = await t.addCheck(TOKEN);
    expect((await kostrishche(t, checkId, foreign.id)).res.status).toBe(202);
    expect(savedTrial(t, "gen-2")).toBeNull();
  });

  it("Поджог другого профиля — отбрасывается", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo() } });
    const otherProfile = await t.addCheck(TOKEN, { igUsername: "someone.else" });
    const trialId = await readyTrial(t, otherProfile);
    const checkId = await t.addCheck(TOKEN);
    expect((await kostrishche(t, checkId, trialId)).res.status).toBe(202);
    expect(savedTrial(t, "gen-2")).toBeNull();
  });

  it("незавершённый Поджог, несуществующий id и не-Поджог — отбрасываются", async () => {
    const t = makeDeps({ promos: { FUNTEST: makePromo({ maxRedemptions: 10, tiers: [2] }) } });
    const checkId = await t.addCheck(TOKEN);
    await send(t, body(checkId)); // gen-1, остаётся queued
    expect((await kostrishche(t, checkId, "gen-1")).res.status).toBe(202);
    expect(savedTrial(t, "gen-2")).toBeNull();

    expect((await kostrishche(t, checkId, "no-such")).res.status).toBe(202);
    expect(savedTrial(t, "gen-3")).toBeNull();

    // Кострище, даже завершённое, не годится как источник.
    const g2 = t.generations.rows.get("gen-2");
    if (g2) g2.status = "ready";
    expect((await kostrishche(t, checkId, "gen-2")).res.status).toBe(202);
    expect(savedTrial(t, "gen-4")).toBeNull();
  });
});

describe("GET /api/generations/:id", () => {
  async function created(t: T) {
    const checkId = await t.addCheck(TOKEN);
    const { json } = await send(t, body(checkId));
    return GenerationCreated.parse(json).id;
  }
  async function status(t: T, id: string, token: string | null = TOKEN) {
    const res = await getGeneration(get(id, token ?? undefined), id, t.deps);
    return { res, json: (await res.json()) as Record<string, unknown> };
  }

  it("владелец видит queued: только id, status, updatedAt; Cache-Control: no-store", async () => {
    const t = makeDeps();
    const id = await created(t);
    const { res, json } = await status(t, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(GenerationStatus.parse(json)).toEqual({
      id,
      status: "queued",
      updatedAt: NOW.toISOString(),
    });
    expect(Object.keys(json).sort()).toEqual(["id", "status", "updatedAt"]);
  });

  it("чужой, несуществующий и без cookie — одинаковый 404", async () => {
    const t = makeDeps();
    const id = await created(t);
    const foreign = await status(t, id, OTHER_TOKEN);
    const missing = await status(t, "no-such-id");
    const noCookie = await status(t, id, null);
    for (const r of [foreign, missing, noCookie]) expect(r.res.status).toBe(404);
    expect(foreign.json).toEqual(missing.json);
    expect(foreign.json).toEqual(noCookie.json);
  });

  it("ready со slug из artifacts; без errorCode", async () => {
    const t = makeDeps();
    const id = await created(t);
    const row = t.generations.rows.get(id);
    if (row) row.status = "ready";
    t.generations.artifacts.set(id, "a1b2c3d4e5");
    const { json } = await status(t, id);
    expect(GenerationStatus.parse(json)).toMatchObject({
      status: "ready",
      artifactSlug: "a1b2c3d4e5",
    });
    expect(json).not.toHaveProperty("errorCode");
  });

  it("failed с errorCode; без artifactSlug; пустой errorCode → internal", async () => {
    const t = makeDeps();
    const id = await created(t);
    await t.generations.repo.markFailed(id, "internal", NOW);
    expect((await status(t, id)).json).toMatchObject({ status: "failed", errorCode: "internal" });

    const row = t.generations.rows.get(id);
    if (row) row.errorCode = null;
    const { json } = await status(t, id);
    expect(json).toMatchObject({ status: "failed", errorCode: "internal" });
    expect(json).not.toHaveProperty("artifactSlug");
  });

  it("лишние данные строки (errorCode у не-failed, slug у не-ready) наружу не уходят", async () => {
    const t = makeDeps();
    const id = await created(t);
    const row = t.generations.rows.get(id);
    if (row) {
      row.status = "writing";
      row.errorCode = "internal";
    }
    t.generations.artifacts.set(id, "leftover");
    const { res, json } = await status(t, id);
    expect(res.status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(["id", "status", "updatedAt"]);
  });

  it("ready без артефакта — не отдаём битый ответ: 500 internal", async () => {
    const t = makeDeps();
    const id = await created(t);
    const row = t.generations.rows.get(id);
    if (row) row.status = "ready";
    const { res, json } = await status(t, id);
    expect(res.status).toBe(500);
    expect(json).toEqual({ errorCode: "internal" });
  });

  it("production без HASH_SALT → 503, БД не читаем", async () => {
    const t = makeDeps();
    const id = await created(t);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HASH_SALT", "");
    try {
      const { res, json } = await status(t, id);
      expect(res.status).toBe(503);
      expect(json).toEqual({ errorCode: "internal" });
      expect(t.generations.repo.get).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("сбой БД → 500 без деталей", async () => {
    const t = makeDeps();
    const id = await created(t);
    t.generations.repo.get.mockRejectedValueOnce(new Error("password=hunter2"));
    const { res, json } = await status(t, id);
    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("hunter2");
  });
});
