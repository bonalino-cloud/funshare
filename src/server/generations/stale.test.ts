import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationStatus, type GenerationStatusCode } from "@/contracts";
import { retentionLogLine } from "../retention/run";
import { createGeneration, getGeneration, postSelection } from "./handlers";
import { failGeneration, runWrite, type PipelineDeps } from "./pipeline";
import { failStaleSql } from "./repository";
import {
  STALE_AFTER_MS,
  STEP_WINDOW_MS,
  WAITING_REPORT_AFTER_MS,
  WAITING_SELECTION_STALE_MS,
  closeStaleGeneration,
  maybeStale,
  staleCutoffs,
  sweepStaleGenerations,
  type StaleDeps,
} from "./stale";
import { get, makeDeps, makePromo, NOW, post, TOKEN, URL_BODY } from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const at = (ms: number) => new Date(NOW.getTime() + ms);

/** Сколько раз `release` реально поменял заказ (вернул true). */
async function effectiveReleases(release: { mock: { results: { value: unknown }[] } }) {
  const results = await Promise.all(release.mock.results.map((r) => r.value as Promise<boolean>));
  return results.filter(Boolean).length;
}

/** Генерация и заказ создаются настоящим POST на фейках; потом строку переводим руками. */
async function setup(over: { tier?: 1 | 2; promoCode?: string } = {}) {
  const t = makeDeps({ promos: { FUNTEST: makePromo({ tiers: [2] }) } });
  const profileCheckId = await t.addCheck(TOKEN);
  const res = await createGeneration(
    post({ ...URL_BODY, profileCheckId, ...over }, { token: TOKEN }),
    t.deps,
  );
  expect(res.status).toBe(202);
  const id = "gen-1";
  const clock = { at: new Date(NOW) };
  const stale: StaleDeps = {
    repo: t.generations.repo,
    orders: t.orders.repo,
    now: () => clock.at,
  };
  /** Поставить статус и «последнее движение»; `selected` — выбор принят. */
  const put = (status: GenerationStatusCode, updatedAt: Date, selected = false) => {
    const row = t.generations.rows.get(id);
    if (!row) throw new Error("нет строки");
    t.generations.rows.set(id, {
      ...row,
      status,
      updatedAt,
      stepTimings: selected
        ? { awaiting_selection: { startedAt: NOW.toISOString(), finishedAt: NOW.toISOString() } }
        : {},
    });
  };
  const row = () => t.generations.rows.get(id);
  return { t, id, stale, clock, put, row };
}

describe("пороги выведены из лимитов", () => {
  it("числа: 23 мин на шаг со всеми повторами, 28 / 51 мин и 10 мин для очереди", () => {
    expect(STEP_WINDOW_MS).toBe(23 * 60_000);
    expect(STALE_AFTER_MS.queued).toBe(10 * 60_000);
    expect(STALE_AFTER_MS.writing).toBe(28 * 60_000);
    expect(STALE_AFTER_MS.afterSelection).toBe(51 * 60_000);
    expect(STALE_AFTER_MS.awaitingSelection).toBe(3 * 24 * 60 * 60_000);
    expect(WAITING_SELECTION_STALE_MS).toBe(STALE_AFTER_MS.awaitingSelection);
  });
});

describe("граница по каждому статусу", () => {
  const cases: [string, GenerationStatusCode, boolean, number][] = [
    ["queued", "queued", false, STALE_AFTER_MS.queued],
    ["writing", "writing", false, STALE_AFTER_MS.writing],
    ["drawing", "drawing", false, STALE_AFTER_MS.afterSelection],
    ["awaiting_selection после выбора", "awaiting_selection", true, STALE_AFTER_MS.afterSelection],
    [
      "awaiting_selection без выбора",
      "awaiting_selection",
      false,
      STALE_AFTER_MS.awaitingSelection,
    ],
  ];

  for (const [name, status, selected, limit] of cases) {
    it(`${name}: ровно на пороге живая, на 1 мс дальше закрывается`, async () => {
      const s = await setup();
      s.put(status, NOW, selected);
      s.clock.at = at(limit);
      expect(await closeStaleGeneration(s.stale, s.id)).toBe(false);
      expect(s.row()?.status).toBe(status);

      s.clock.at = at(limit + 1);
      expect(await closeStaleGeneration(s.stale, s.id)).toBe(true);
      expect(s.row()).toMatchObject({ status: "failed", errorCode: "internal" });
    });
  }

  it("предпроверка maybeStale совпадает с порогами и не трогает ready/failed", () => {
    const old = new Date(0);
    expect(maybeStale({ status: "writing", updatedAt: at(-STALE_AFTER_MS.writing - 1) }, NOW)).toBe(
      true,
    );
    expect(maybeStale({ status: "writing", updatedAt: at(-STALE_AFTER_MS.writing) }, NOW)).toBe(
      false,
    );
    // awaiting_selection: выбор в строке не виден, берём меньший порог; в первые 51 мин UPDATE не нужен.
    const waitingRow = (ms: number) => ({
      status: "awaiting_selection" as const,
      updatedAt: at(-ms),
    });
    expect(maybeStale(waitingRow(STALE_AFTER_MS.afterSelection), NOW)).toBe(false);
    expect(maybeStale(waitingRow(STALE_AFTER_MS.afterSelection + 1), NOW)).toBe(true);
    expect(maybeStale({ status: "ready", updatedAt: old }, NOW)).toBe(false);
    expect(maybeStale({ status: "failed", updatedAt: old }, NOW)).toBe(false);
  });

  it("awaiting_selection без выбора живёт до 3 суток включительно", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    for (const ms of [
      STALE_AFTER_MS.afterSelection + 1,
      24 * 60 * 60_000,
      WAITING_SELECTION_STALE_MS - 60_000,
      WAITING_SELECTION_STALE_MS,
    ]) {
      s.clock.at = at(ms);
      expect(await closeStaleGeneration(s.stale, s.id)).toBe(false);
      expect((await sweepStaleGenerations(s.stale)).closed).toBe(0);
    }
    expect(s.row()?.status).toBe("awaiting_selection");
    expect(s.t.orders.orders[0]?.status).toBe("free");
  });

  it("через 51 мин закрывается строка с принятым выбором, без выбора ещё нет", async () => {
    const accepted = await setup();
    accepted.put("awaiting_selection", NOW, true);
    const waiting = await setup();
    waiting.put("awaiting_selection", NOW, false);
    const clock = at(STALE_AFTER_MS.afterSelection + 1);
    accepted.clock.at = clock;
    waiting.clock.at = clock;
    expect(await closeStaleGeneration(accepted.stale, accepted.id)).toBe(true);
    expect(await closeStaleGeneration(waiting.stale, waiting.id)).toBe(false);
  });

  it("ready не трогается, заказ остаётся", async () => {
    const s = await setup();
    s.put("ready", NOW);
    s.clock.at = at(365 * 24 * 60 * 60_000);
    expect(await closeStaleGeneration(s.stale, s.id)).toBe(false);
    expect(s.row()?.status).toBe("ready");
    expect(s.t.orders.orders[0]?.status).toBe("free");
  });
});

describe("закрытие и заказ", () => {
  it("тот же исход, что у failGeneration: failed/internal и заказ освобождён (проба возвращена)", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    await closeStaleGeneration(s.stale, s.id);
    expect(s.row()).toMatchObject({ status: "failed", errorCode: "internal" });
    expect(s.t.orders.orders[0]?.status).toBe("voided");
  });

  it("промокод: использование освобождено и счётчик вернулся ровно один раз", async () => {
    const s = await setup({ tier: 2, promoCode: "FUNTEST" });
    const code = s.t.orders.codes.get("FUNTEST");
    expect(code?.redeemed).toBe(1);
    s.put("queued", NOW);
    s.clock.at = at(STALE_AFTER_MS.queued + 1);
    await closeStaleGeneration(s.stale, s.id);
    await closeStaleGeneration(s.stale, s.id);
    await sweepStaleGenerations(s.stale);
    expect(s.t.orders.orders[0]?.status).toBe("voided");
    expect(code?.redeemed).toBe(0);
  });

  it("повторное закрытие и подметание после: закрыто один раз, release меняет заказ один раз", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    const first = await closeStaleGeneration(s.stale, s.id);
    const second = await closeStaleGeneration(s.stale, s.id);
    const sweep = await sweepStaleGenerations(s.stale);
    expect([first, second]).toEqual([true, false]);
    expect(sweep).toMatchObject({ closed: 0, released: 0, releaseFailures: 0 });
    expect(await effectiveReleases(s.t.orders.repo.release)).toBe(1);
  });

  it("два сторожа параллельно: строку закрывает один", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    const [a, b] = await Promise.all([
      closeStaleGeneration(s.stale, s.id),
      closeStaleGeneration(s.stale, s.id),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(s.t.orders.orders[0]?.status).toBe("voided");
    expect(await effectiveReleases(s.t.orders.repo.release)).toBe(1);
  });

  it("гонка: шаг сдвинул статус между чтением и закрытием, строку не закрываем", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    // Сторож «прочитал» старую строку, но к моменту UPDATE шаг уже сдвинул её и обновил updatedAt.
    const realFail = s.t.generations.repo.failStale.getMockImplementation();
    s.t.generations.repo.failStale.mockImplementationOnce(async (input) => {
      const row = s.row();
      if (row) {
        s.t.generations.rows.set(s.id, {
          ...row,
          status: "awaiting_selection",
          updatedAt: s.clock.at,
        });
      }
      return realFail ? realFail(input) : [];
    });
    expect(await closeStaleGeneration(s.stale, s.id)).toBe(false);
    expect(s.row()?.status).toBe("awaiting_selection");
    expect(s.t.orders.orders[0]?.status).toBe("free");
  });

  it("недавний ход (advance обновил updatedAt): живая, не закрываем", async () => {
    const s = await setup();
    s.put("writing", at(STALE_AFTER_MS.writing - 1000));
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    expect(await closeStaleGeneration(s.stale, s.id)).toBe(false);
  });
});

describe("брошенный выбор: 3 суток без движения", () => {
  const DAY = 24 * 60 * 60_000;
  const submit = (s: Awaited<ReturnType<typeof setup>>) =>
    s.t.generations.repo.submitSelection({
      generationId: s.id,
      punchIds: ["p1"],
      max: 1,
      now: s.clock.at,
    });

  it("закрывается failed/internal, заказ освобождён, проба возвращена", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.clock.at = at(WAITING_SELECTION_STALE_MS + 1);
    expect(await closeStaleGeneration(s.stale, s.id)).toBe(true);
    expect(s.row()).toMatchObject({ status: "failed", errorCode: "internal" });
    expect(s.t.orders.orders[0]?.status).toBe("voided");
  });

  it("промокод возвращается ровно один раз (закрытие, потом подметание)", async () => {
    const s = await setup({ tier: 2, promoCode: "FUNTEST" });
    const code = s.t.orders.codes.get("FUNTEST");
    expect(code?.redeemed).toBe(1);
    s.put("awaiting_selection", NOW, false);
    s.clock.at = at(WAITING_SELECTION_STALE_MS + 1);
    await closeStaleGeneration(s.stale, s.id);
    await sweepStaleGenerations(s.stale);
    expect(code?.redeemed).toBe(0);
    expect(await effectiveReleases(s.t.orders.repo.release)).toBe(1);
  });

  it("подметание закрывает и освобождает; закрытая в счётчик ожидающих не попадает", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.clock.at = at(WAITING_SELECTION_STALE_MS + 1);
    expect(await sweepStaleGenerations(s.stale)).toEqual({
      closed: 1,
      released: 1,
      releaseFailures: 0,
      waiting: 0,
      truncated: false,
    });
  });

  it("живая строка моложе 3 суток не трогается, хотя ждёт больше суток", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.clock.at = at(2 * DAY);
    expect(await sweepStaleGenerations(s.stale)).toMatchObject({
      closed: 0,
      released: 0,
      waiting: 1,
    });
    expect(s.row()?.status).toBe("awaiting_selection");
    expect(s.t.orders.orders[0]?.status).toBe("free");
  });

  it("выбор принят после порога, но до сторожа: строка живая, старый срок не наследует", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.t.generations.addCandidates(s.id, [{ punchId: "p1", text: "a" }]);
    s.clock.at = at(WAITING_SELECTION_STALE_MS + 1);
    expect(await submit(s)).toBe(true);
    expect(await closeStaleGeneration(s.stale, s.id)).toBe(false);
    expect(s.row()?.status).toBe("awaiting_selection");
    expect(s.t.orders.orders[0]?.status).toBe("free");
  });

  it("выбор после закрытия отклоняется: submitSelection false, POST selection 409, воркфлоу не будят", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.t.generations.addCandidates(s.id, [{ punchId: "p1", text: "a" }]);
    s.clock.at = at(WAITING_SELECTION_STALE_MS + 1);
    await closeStaleGeneration(s.stale, s.id);

    expect(await submit(s)).toBe(false);

    const resume = vi.fn(async () => {});
    const res = await postSelection(
      new NextRequest("http://localhost/api/generations/gen-1/selection", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `ownerToken=${TOKEN}` },
        body: JSON.stringify({ punchIds: ["p1"] }),
      }),
      s.id,
      { repo: s.t.generations.repo, resumeSelection: resume, now: s.stale.now },
    );
    expect(res.status).toBe(409);
    expect(resume).not.toHaveBeenCalled();
    expect(s.row()?.status).toBe("failed");
  });

  it("гонка: человек нажал «выбрать» прямо перед сторожем, строка живая, заказ цел", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.t.generations.addCandidates(s.id, [{ punchId: "p1", text: "a" }]);
    s.clock.at = at(WAITING_SELECTION_STALE_MS + 1);
    const realFail = s.t.generations.repo.failStale.getMockImplementation();
    s.t.generations.repo.failStale.mockImplementationOnce(async (input) => {
      await submit(s);
      return realFail ? realFail(input) : [];
    });
    expect(await closeStaleGeneration(s.stale, s.id)).toBe(false);
    expect(s.row()?.status).toBe("awaiting_selection");
    expect(s.t.orders.orders[0]?.status).toBe("free");
    expect(await effectiveReleases(s.t.orders.repo.release)).toBe(0);
  });

  it("гонка параллельно: побеждает ровно один, освобождение не двойное", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.t.generations.addCandidates(s.id, [{ punchId: "p1", text: "a" }]);
    s.clock.at = at(WAITING_SELECTION_STALE_MS + 1);
    const [closed, taken] = await Promise.all([closeStaleGeneration(s.stale, s.id), submit(s)]);
    expect(closed).not.toBe(taken);
    expect(s.row()?.status).toBe(closed ? "failed" : "awaiting_selection");
    expect(await effectiveReleases(s.t.orders.repo.release)).toBe(closed ? 1 : 0);
  });
});

describe("строка лога Cron", () => {
  it("закрытая брошенная генерация попадает в stuckClosed/stuckReleased, не в awaitingOver24h", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.clock.at = at(WAITING_SELECTION_STALE_MS + 1);
    const sweep = await sweepStaleGenerations(s.stale);
    const none = { deleted: 0, truncated: false, error: null };
    const line = retentionLogLine({
      stuck: {
        closed: sweep.closed,
        released: sweep.released,
        waiting: sweep.waiting,
        truncated: sweep.truncated,
        error: null,
      },
      traces: none,
      snapshots: none,
      raw: none,
      avatars: { ...none, cleared: 0 },
    });
    expect(line).toContain("stuckClosed=1 stuckReleased=1 awaitingOver24h=0");
  });
});

describe("проснувшийся workflow на закрытой строке", () => {
  const pipeline = (s: Awaited<ReturnType<typeof setup>>, write: PipelineDeps["write"]) =>
    ({
      repo: s.t.generations.repo,
      orders: s.t.orders.repo,
      now: () => s.clock.at,
      write,
    }) satisfies PipelineDeps;

  it("runWrite после закрытия ничего не пишет и не зовёт модель", async () => {
    const s = await setup();
    s.put("queued", NOW);
    s.clock.at = at(STALE_AFTER_MS.queued + 1);
    await closeStaleGeneration(s.stale, s.id);
    const write = vi.fn<PipelineDeps["write"]>(async () => {});
    expect(await runWrite(pipeline(s, write), s.id)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(s.row()?.status).toBe("failed");
  });

  it("повтор попытки write отмечает жизнь: порог считается от последней попытки", async () => {
    const s = await setup();
    s.put("writing", NOW);
    // Первая попытка убита по лимиту; очередь перевыдала шаг почти у самого порога.
    s.clock.at = at(STALE_AFTER_MS.writing - 1000);
    const write = vi.fn<PipelineDeps["write"]>(async () => {
      // Пока идёт эта попытка, проходит ещё один порог от ПЕРВОЙ попытки, но не от этой.
      s.clock.at = at(STALE_AFTER_MS.writing + 60_000);
      expect(await closeStaleGeneration(s.stale, s.id)).toBe(false);
    });
    expect(await runWrite(pipeline(s, write), s.id)).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(s.row()?.status).toBe("awaiting_selection");
  });

  it("шаг write дописал после закрытия: advance вернул false, статус остался failed", async () => {
    const s = await setup();
    const deps = pipeline(s, async () => {
      // Пока модель думала, строку закрыл сторож.
      s.put("writing", NOW);
      s.clock.at = at(STALE_AFTER_MS.writing + 1);
      await closeStaleGeneration(s.stale, s.id);
    });
    expect(await runWrite(deps, s.id)).toBe(false);
    expect(s.row()?.status).toBe("failed");
    await expect(s.t.generations.repo.advance.mock.results.at(-1)?.value).resolves.toBe(false);
  });

  it("failGeneration после сторожа безвреден: заказ не освобождается дважды", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    await closeStaleGeneration(s.stale, s.id);
    await failGeneration(
      pipeline(s, async () => {}),
      s.id,
    );
    expect(await effectiveReleases(s.t.orders.repo.release)).toBe(1);
  });
});

describe("GET /api/generations/:id закрывает зависшую", () => {
  async function status(s: Awaited<ReturnType<typeof setup>>) {
    const res = await getGeneration(get(s.id, TOKEN), s.id, {
      repo: s.t.generations.repo,
      orders: s.t.orders.repo,
      now: s.stale.now,
    });
    return { res, json: (await res.json()) as Record<string, unknown> };
  }

  it("зависшая writing: ответ failed/internal по контракту, заказ освобождён", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    const { res, json } = await status(s);
    expect(res.status).toBe(200);
    expect(GenerationStatus.parse(json)).toMatchObject({ status: "failed", errorCode: "internal" });
    expect(s.t.orders.orders[0]?.status).toBe("voided");
  });

  it("свежая не трогается и не вызывает UPDATE", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing - 1000);
    const { json } = await status(s);
    expect(json.status).toBe("writing");
    expect(s.t.generations.repo.failStale).not.toHaveBeenCalled();
    expect(s.t.orders.orders[0]?.status).toBe("free");
  });

  it("ожидание выбора: до 3 суток GET не закрывает, после закрывает как failed/internal", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.clock.at = at(WAITING_SELECTION_STALE_MS - 1000);
    expect((await status(s)).json.status).toBe("awaiting_selection");
    expect(s.t.orders.orders[0]?.status).toBe("free");

    s.clock.at = at(WAITING_SELECTION_STALE_MS + 1);
    const { json } = await status(s);
    expect(GenerationStatus.parse(json)).toMatchObject({ status: "failed", errorCode: "internal" });
    expect(s.t.orders.orders[0]?.status).toBe("voided");
  });

  it("ожидающая строка младше 51 мин: GET не шлёт UPDATE", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.clock.at = at(STALE_AFTER_MS.afterSelection - 1000);
    await status(s);
    expect(s.t.generations.repo.failStale).not.toHaveBeenCalled();
  });

  it("сбой закрытия не ломает ответ: отдаём строку как есть", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    s.t.generations.repo.failStale.mockRejectedValueOnce(new Error("db down"));
    const { res, json } = await status(s);
    expect(res.status).toBe(200);
    expect(json.status).toBe("writing");
  });

  it("закрыли, а освободить заказ не вышло: человек видит failed, заказ дочистит Cron", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    s.t.orders.repo.release.mockRejectedValueOnce(new Error("db down"));
    const { json } = await status(s);
    expect(json.status).toBe("failed");
    expect(s.t.orders.orders[0]?.status).toBe("free");

    const sweep = await sweepStaleGenerations(s.stale);
    expect(sweep).toMatchObject({ closed: 0, released: 1, releaseFailures: 0 });
    expect(s.t.orders.orders[0]?.status).toBe("voided");
  });
});

describe("подметание пачкой", () => {
  it("закрывает зависшую, освобождает заказ, возвращает числа", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    expect(await sweepStaleGenerations(s.stale)).toEqual({
      closed: 1,
      released: 1,
      releaseFailures: 0,
      waiting: 0,
      truncated: false,
    });
  });

  it("сбой освобождения считается, а не роняет подметание", async () => {
    const s = await setup();
    s.put("writing", NOW);
    s.clock.at = at(STALE_AFTER_MS.writing + 1);
    s.t.orders.repo.release.mockRejectedValueOnce(new Error("db down"));
    expect(await sweepStaleGenerations(s.stale)).toMatchObject({
      closed: 1,
      released: 0,
      releaseFailures: 1,
    });
    // Следующий прогон дочищает заказ.
    expect(await sweepStaleGenerations(s.stale)).toMatchObject({
      closed: 0,
      released: 1,
      releaseFailures: 0,
    });
  });

  it("считает awaiting_selection старше 24 ч (моложе 3 суток), но не закрывает и не освобождает", async () => {
    const s = await setup();
    s.put("awaiting_selection", NOW, false);
    s.clock.at = at(WAITING_REPORT_AFTER_MS - 1);
    expect((await sweepStaleGenerations(s.stale)).waiting).toBe(0);
    s.clock.at = at(WAITING_REPORT_AFTER_MS + 1);
    expect(await sweepStaleGenerations(s.stale)).toMatchObject({
      closed: 0,
      released: 0,
      waiting: 1,
    });
    expect(s.row()?.status).toBe("awaiting_selection");
    expect(s.t.orders.orders[0]?.status).toBe("free");
  });

  it("потолок: не больше limit за прогон, остаток помечен truncated и доделывается", async () => {
    const t = makeDeps();
    for (let n = 1; n <= 3; n += 1) {
      const token = `${n}`.repeat(43);
      const profileCheckId = await t.addCheck(token, { igUsername: `user${n}` });
      const res = await createGeneration(
        post({ ...URL_BODY, profileCheckId }, { token, ip: `10.0.0.${n}` }),
        t.deps,
      );
      expect(res.status).toBe(202);
    }
    const now = at(STALE_AFTER_MS.queued + 1000);
    const stale: StaleDeps = { repo: t.generations.repo, orders: t.orders.repo, now: () => now };
    expect(await sweepStaleGenerations(stale, 2)).toMatchObject({ closed: 2, truncated: true });
    expect(await sweepStaleGenerations(stale, 2)).toMatchObject({ closed: 1, truncated: false });
    expect(t.orders.orders.every((o) => o.status === "voided")).toBe(true);
  });

  it("границы считаются от now", () => {
    expect(staleCutoffs(NOW).writing.getTime()).toBe(NOW.getTime() - STALE_AFTER_MS.writing);
  });
});

describe("SQL закрытия", () => {
  const dialect = new PgDialect();
  const flat = (text: string) => text.replace(/\s+/g, " ").replace(/\( /g, "(").trim();
  const query = dialect.sqlToQuery(
    failStaleSql({ cutoffs: staleCutoffs(NOW), now: NOW, limit: 50 }),
  );
  const text = flat(query.sql);

  it("одна команда UPDATE; условие стоит и в выборке, и на самой строке", () => {
    expect(
      text.startsWith("UPDATE generations SET status = 'failed', error_code = 'internal'"),
    ).toBe(true);
    expect(text.match(/status = 'writing' AND updated_at </g)).toHaveLength(2);
    expect(text).toContain("FOR UPDATE SKIP LOCKED");
    expect(text).toContain("RETURNING id");
  });

  it("awaiting_selection: ветки «выбор принят» и «не принят», каждая в обоих местах; ready и failed нет", () => {
    const branch = (nullness: string) =>
      new RegExp(
        `status = 'awaiting_selection' AND step_timings #> '\\{awaiting_selection,finishedAt\\}' IS ${nullness} AND updated_at <`,
        "g",
      );
    expect(text.match(branch("NOT NULL"))).toHaveLength(2);
    expect(text.match(branch("NULL"))).toHaveLength(2);
    expect(text).not.toMatch(/status = 'ready'/);
    expect(text).not.toMatch(/status = 'failed' AND/);
  });

  it("id и границы идут параметрами", () => {
    const withId = dialect.sqlToQuery(
      failStaleSql({ cutoffs: staleCutoffs(NOW), now: NOW, limit: 1, id: "g-1" }),
    );
    expect(withId.params).toContain("g-1");
    expect(withId.params).toContain(staleCutoffs(NOW).writing.toISOString());
    // Границы разные: короткая для принятого выбора, 3 суток для брошенного.
    expect(withId.params).toContain(staleCutoffs(NOW).afterSelection.toISOString());
    expect(withId.params).toContain(staleCutoffs(NOW).waitingSelection.toISOString());
    expect(staleCutoffs(NOW).waitingSelection.getTime()).toBe(NOW.getTime() - 3 * 24 * 60 * 60_000);
  });
});
