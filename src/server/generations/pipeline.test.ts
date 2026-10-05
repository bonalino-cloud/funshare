import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGeneration } from "./handlers";
import { failGeneration, runDraw, runWrite, type PipelineDeps } from "./pipeline";
import { makeDeps, makePromo, NOW, post, TOKEN, URL_BODY } from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Генерация и заказ создаются настоящим POST на фейках, как в бою; шаги идут по ним. */
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
  const deps: PipelineDeps = {
    repo: t.generations.repo,
    orders: t.orders.repo,
    now: () => clock.at,
  };
  const row = () => t.generations.rows.get(id);
  return { t, id, deps, clock, row };
}

const tick = (clock: { at: Date }, ms: number) => {
  clock.at = new Date(clock.at.getTime() + ms);
};

describe("write", () => {
  it("queued → awaiting_selection, тайминги write и начало ожидания выбора", async () => {
    const { deps, id, row } = await setup();
    await runWrite(deps, id);
    expect(row()?.status).toBe("awaiting_selection");
    expect(row()?.stepTimings).toEqual({
      write: { startedAt: NOW.toISOString(), finishedAt: NOW.toISOString() },
      awaiting_selection: { startedAt: NOW.toISOString() },
    });
  });

  it("статусы идут по порядку: queued → writing → awaiting_selection, без ready", async () => {
    const { deps, id, t } = await setup();
    await runWrite(deps, id);
    const seen = t.generations.repo.advance.mock.calls.map(([, input]) => input.to);
    expect(seen).toEqual(["writing", "awaiting_selection"]);
  });

  it("повтор после полного прохода не откатывает статус и не трогает тайминги", async () => {
    const { deps, id, row, clock } = await setup();
    await runWrite(deps, id);
    const before = structuredClone(row()?.stepTimings);
    tick(clock, 5000);
    await runWrite(deps, id);
    expect(row()?.status).toBe("awaiting_selection");
    expect(row()?.stepTimings).toEqual(before);
  });

  it("повтор после падения между двумя переходами: доезжает, startedAt от первой попытки", async () => {
    const { t, deps, id, row, clock } = await setup();
    const real = t.generations.repo.advance.getMockImplementation();
    if (!real) throw new Error("нет реализации фейка");
    t.generations.repo.advance.mockImplementationOnce(real);
    t.generations.repo.advance.mockImplementationOnce(async () => {
      throw new Error("db blip");
    });
    await expect(runWrite(deps, id)).rejects.toThrow("db blip");
    expect(row()?.status).toBe("writing");
    tick(clock, 7000);
    await runWrite(deps, id);
    expect(row()?.status).toBe("awaiting_selection");
    expect(row()?.stepTimings.write).toEqual({
      startedAt: NOW.toISOString(),
      finishedAt: "2026-10-03T12:00:07.000Z",
    });
  });

  it("результат: true после прохода и после повтора, false у закрытой и неизвестной", async () => {
    const { deps, id } = await setup();
    expect(await runWrite(deps, id)).toBe(true);
    expect(await runWrite(deps, id)).toBe(true);
    expect(await runWrite(deps, "nope")).toBe(false);
  });

  it("failed не оживает: повтор write ничего не меняет", async () => {
    const { deps, id, row } = await setup();
    await failGeneration(deps, id);
    expect(await runWrite(deps, id)).toBe(false);
    expect(row()?.status).toBe("failed");
    expect(row()?.errorCode).toBe("internal");
  });
});

describe("draw", () => {
  it("Поджог (тариф 1): пропуск, статус и тайминги не меняются", async () => {
    const { deps, id, row } = await setup({ tier: 1 });
    await runWrite(deps, id);
    expect(await runDraw(deps, id)).toBe("skipped");
    expect(row()?.status).toBe("awaiting_selection");
    expect(row()?.stepTimings.draw).toBeUndefined();
  });

  it("Кострище: awaiting_selection → drawing, тайминги draw; повтор безвреден", async () => {
    const { deps, id, row, clock } = await setup({ tier: 2, promoCode: "funtest" });
    await runWrite(deps, id);
    tick(clock, 1000);
    expect(await runDraw(deps, id)).toBe("done");
    expect(row()?.status).toBe("drawing");
    const draw = row()?.stepTimings.draw;
    expect(draw?.startedAt).toBe("2026-10-03T12:00:01.000Z");
    expect(draw?.finishedAt).toBe("2026-10-03T12:00:01.000Z");
    tick(clock, 1000);
    await runDraw(deps, id);
    expect(row()?.status).toBe("drawing");
    expect(row()?.stepTimings.draw).toEqual(draw);
  });

  it("draw не стартует из queued (шаг write не прошёл): статус не перескакивает", async () => {
    const { deps, id, row } = await setup({ tier: 2, promoCode: "funtest" });
    await runDraw(deps, id);
    expect(row()?.status).toBe("queued");
  });
});

describe("провал: failed/internal + release заказа", () => {
  it("Кострище по коду: failed, заказ voided, код освобождён", async () => {
    const { t, deps, id, row } = await setup({ tier: 2, promoCode: "funtest" });
    await runWrite(deps, id);
    await failGeneration(deps, id);
    expect(row()).toMatchObject({ status: "failed", errorCode: "internal" });
    expect(t.orders.orders[0]?.status).toBe("voided");
    expect(t.orders.codes.get("FUNTEST")?.redeemed).toBe(0);
  });

  it("Поджог: проба возвращается человеку (заказ voided)", async () => {
    const { t, deps, id } = await setup();
    await failGeneration(deps, id);
    expect(t.orders.orders[0]?.status).toBe("voided");
  });

  it("повторный провал: release второй раз ничего не меняет (счётчик не уходит в минус)", async () => {
    const { t, deps, id } = await setup({ tier: 2, promoCode: "funtest" });
    await failGeneration(deps, id);
    await failGeneration(deps, id);
    expect(t.orders.codes.get("FUNTEST")?.redeemed).toBe(0);
    expect(t.orders.redemptions).toHaveLength(1);
    expect(t.orders.redemptions[0]?.releasedAt).toEqual(NOW);
  });

  it("сбой release после failed: ретрай шага довершает освобождение", async () => {
    const { t, deps, id } = await setup();
    t.orders.repo.release.mockRejectedValueOnce(new Error("db down"));
    await expect(failGeneration(deps, id)).rejects.toThrow("db down");
    expect(t.orders.orders[0]?.status).toBe("free");
    await failGeneration(deps, id);
    expect(t.orders.orders[0]?.status).toBe("voided");
  });

  it("ready: артефакт есть, генерацию и заказ не трогаем", async () => {
    const { t, deps, id, row } = await setup();
    const stored = row();
    if (stored) t.generations.rows.set(id, { ...stored, status: "ready" });
    await failGeneration(deps, id);
    expect(row()?.status).toBe("ready");
    expect(t.orders.orders[0]?.status).toBe("free");
    expect(t.orders.repo.release).not.toHaveBeenCalled();
  });

  it("неизвестный id: ничего не падает и ничего не освобождается", async () => {
    const { t, deps } = await setup();
    await failGeneration(deps, "nope");
    expect(t.orders.repo.release).not.toHaveBeenCalled();
  });
});
