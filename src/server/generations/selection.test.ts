import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Artifact, CandidatesResponse } from "@/contracts";
import { richRu } from "../facts/fixtures";
import { runWriteStep } from "../roast/write";
import type { WriteRepository } from "../roast/write/repository";
import type { WrittenCandidate } from "../roast/write/types";
import { makePersona, makeTrace, makeWriteDeps } from "../roast/write/test-helpers";
import { runAssemble } from "./assemble";
import {
  createGeneration,
  getCandidates,
  postSelection,
  type SelectionHandlerDeps,
} from "./handlers";
import { runDraw, type PipelineDeps } from "./pipeline";
import {
  makeArtifactRepo,
  makeDeps,
  makePromo,
  NOW,
  OTHER_TOKEN,
  post,
  TOKEN,
  URL_BODY,
} from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const CANDIDATES = Array.from({ length: 10 }, (_, i) => ({
  punchId: `p${i + 1}`,
  emoji: "🔥",
  text: `Шутка номер ${i + 1}`,
}));

/** Генерация создаётся настоящим POST на фейках и ставится в `awaiting_selection`, как после write. */
async function setup(over: { tier?: 1 | 2 } = {}) {
  const t = makeDeps({ promos: { FUNTEST: makePromo() } });
  const profileCheckId = await t.addCheck(TOKEN);
  const res = await createGeneration(
    post(
      {
        ...URL_BODY,
        profileCheckId,
        tier: over.tier ?? 1,
        ...(over.tier === 2 ? { promoCode: "fun-test" } : {}),
      },
      { token: TOKEN },
    ),
    t.deps,
  );
  expect(res.status).toBeLessThan(300);
  const id = "gen-1";
  const g = t.generations;
  g.addCandidates(id, CANDIDATES);
  const row = g.rows.get(id);
  if (!row) throw new Error("нет строки");
  g.rows.set(id, {
    ...row,
    status: "awaiting_selection",
    stepTimings: { awaiting_selection: { startedAt: NOW.toISOString() } },
  });
  const resumeSelection = vi.fn<SelectionHandlerDeps["resumeSelection"]>(async () => {});
  const deps: SelectionHandlerDeps = { repo: g.repo, resumeSelection, now: () => NOW };
  const setStatus = (status: NonNullable<ReturnType<typeof g.rows.get>>["status"]) => {
    const r = g.rows.get(id);
    if (r) g.rows.set(id, { ...r, status });
  };
  return { t, g, id, deps, resumeSelection, setStatus };
}

const selectionRequest = (id: string, body: unknown, token: string | null = TOKEN) =>
  new NextRequest(`http://localhost/api/generations/${id}/selection`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `ownerToken=${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const candidatesRequest = (token: string | null = TOKEN) =>
  new NextRequest("http://localhost/api/generations/x/candidates", {
    headers: token ? { cookie: `ownerToken=${token}` } : {},
  });

describe("GET candidates", () => {
  it("владельцу при awaiting_selection: контрактный ответ, только id/emoji/text, selectCount тарифа", async () => {
    const { id, deps } = await setup();
    const res = await getCandidates(candidatesRequest(), id, deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = CandidatesResponse.parse(await res.json());
    expect(body.generationId).toBe(id);
    expect(body.selectCount).toBe(6);
    expect(body.candidates).toHaveLength(10);
    expect(Object.keys(body.candidates[0] ?? {}).sort()).toEqual(["emoji", "id", "text"]);
  });

  it("чужой, без cookie и несуществующий id: одинаковый 404", async () => {
    const { id, deps } = await setup();
    const statuses = [
      (await getCandidates(candidatesRequest(OTHER_TOKEN), id, deps)).status,
      (await getCandidates(candidatesRequest(null), id, deps)).status,
      (await getCandidates(candidatesRequest(), "nope", deps)).status,
    ];
    expect(statuses).toEqual([404, 404, 404]);
  });

  it("другой статус: 409", async () => {
    const { id, deps, setStatus } = await setup();
    for (const status of ["queued", "writing", "drawing", "ready", "failed"] as const) {
      setStatus(status);
      const res = await getCandidates(candidatesRequest(), id, deps);
      expect(res.status, status).toBe(409);
    }
  });

  it("пустой список не уходит наружу (контракт требует минимум 1)", async () => {
    const { id, deps, g } = await setup();
    g.candidates.set(id, []);
    expect((await getCandidates(candidatesRequest(), id, deps)).status).toBe(500);
  });

  it("перенесённая шутка отдаётся с fromTrial", async () => {
    const { id, deps, g } = await setup({ tier: 2 });
    const first = g.candidates.get(id)?.[0];
    if (first) first.fromTrial = true;
    const res = await getCandidates(candidatesRequest(), id, deps);
    const body = CandidatesResponse.parse(await res.json());
    expect(body.candidates[0]?.fromTrial).toBe(true);
    expect(body.candidates[1]?.fromTrial).toBeUndefined();
  });
});

describe("POST selection", () => {
  it("принимает выбор: 202 без тела, порядок сохранён, workflow разбужен один раз", async () => {
    const { id, deps, g, resumeSelection } = await setup();
    const res = await postSelection(
      selectionRequest(id, { punchIds: ["p7", "p2", "p5"] }),
      id,
      deps,
    );
    expect(res.status).toBe(202);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
    expect(await g.repo.listSelection(id)).toEqual(["p7", "p2", "p5"]);
    expect(resumeSelection).toHaveBeenCalledExactlyOnceWith(id);
    expect(g.rows.get(id)?.stepTimings.awaiting_selection?.finishedAt).toBe(NOW.toISOString());
  });

  it("граница числа: ровно selectCount проходит, на один больше или пусто даёт 400", async () => {
    const ids6 = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const ok = await setup();
    expect(
      (await postSelection(selectionRequest(ok.id, { punchIds: ids6 }), ok.id, ok.deps)).status,
    ).toBe(202);

    const over = await setup();
    const res = await postSelection(
      selectionRequest(over.id, { punchIds: [...ids6, "p7"] }),
      over.id,
      over.deps,
    );
    expect(res.status).toBe(400);
    expect(await over.g.repo.listSelection(over.id)).toEqual([]);
    expect(over.resumeSelection).not.toHaveBeenCalled();

    const none = await setup();
    const empty = await postSelection(
      selectionRequest(none.id, { punchIds: [] }),
      none.id,
      none.deps,
    );
    expect(empty.status).toBe(400);
  });

  it("меньше selectCount допустимо (от 1)", async () => {
    const { id, deps } = await setup();
    expect((await postSelection(selectionRequest(id, { punchIds: ["p3"] }), id, deps)).status).toBe(
      202,
    );
  });

  it("чужой id шутки (и из другой генерации): 400, ничего не записано", async () => {
    const { id, deps, g, resumeSelection } = await setup();
    g.addCandidates("other-gen", [{ punchId: "x1", text: "чужая" }]);
    for (const ids of [["p1", "zzz"], ["x1"]]) {
      const res = await postSelection(selectionRequest(id, { punchIds: ids }), id, deps);
      expect(res.status).toBe(400);
    }
    expect(await g.repo.listSelection(id)).toEqual([]);
    expect(resumeSelection).not.toHaveBeenCalled();
  });

  it("дубли и битое тело: 400; лишние поля игнорируются, статус из тела не берётся", async () => {
    const { id, deps, g } = await setup();
    for (const body of [{ punchIds: ["p1", "p1"] }, "{не json", { punchIds: "p1" }, {}]) {
      expect((await postSelection(selectionRequest(id, body), id, deps)).status).toBe(400);
    }
    const res = await postSelection(
      selectionRequest(id, { punchIds: ["p1"], text: "подмена", status: "ready" }),
      id,
      deps,
    );
    expect(res.status).toBe(202);
    expect(g.rows.get(id)?.status).toBe("awaiting_selection");
  });

  it("чужой, без cookie, несуществующий: 404, выбор не принят, workflow не разбужен", async () => {
    const { id, deps, g, resumeSelection } = await setup();
    const body = { punchIds: ["p1"] };
    expect((await postSelection(selectionRequest(id, body, OTHER_TOKEN), id, deps)).status).toBe(
      404,
    );
    expect((await postSelection(selectionRequest(id, body, null), id, deps)).status).toBe(404);
    expect((await postSelection(selectionRequest("nope", body), "nope", deps)).status).toBe(404);
    expect(await g.repo.listSelection(id)).toEqual([]);
    expect(resumeSelection).not.toHaveBeenCalled();
  });

  it("статус не тот (queued, writing, failed): 409", async () => {
    const { id, deps, setStatus, resumeSelection } = await setup();
    for (const status of ["queued", "writing", "failed"] as const) {
      setStatus(status);
      const res = await postSelection(selectionRequest(id, { punchIds: ["p1"] }), id, deps);
      expect(res.status, status).toBe(409);
    }
    expect(resumeSelection).not.toHaveBeenCalled();
  });

  it("повтор того же выбора: 202, пока workflow ждёт, будим снова", async () => {
    const { id, deps, resumeSelection } = await setup();
    const body = { punchIds: ["p4", "p1"] };
    expect((await postSelection(selectionRequest(id, body), id, deps)).status).toBe(202);
    expect((await postSelection(selectionRequest(id, body), id, deps)).status).toBe(202);
    expect(resumeSelection).toHaveBeenCalledTimes(2);
  });

  it("повтор того же выбора после ухода вперёд (drawing, ready): 202 без пробуждения", async () => {
    const { id, deps, setStatus, resumeSelection } = await setup();
    const body = { punchIds: ["p4", "p1"] };
    await postSelection(selectionRequest(id, body), id, deps);
    resumeSelection.mockClear();
    for (const status of ["drawing", "ready"] as const) {
      setStatus(status);
      expect((await postSelection(selectionRequest(id, body), id, deps)).status, status).toBe(202);
    }
    expect(resumeSelection).not.toHaveBeenCalled();
  });

  it("другой выбор (набор или порядок) после принятого: 409, принятый не меняется", async () => {
    const { id, deps, g } = await setup();
    await postSelection(selectionRequest(id, { punchIds: ["p4", "p1"] }), id, deps);
    for (const ids of [["p1", "p4"], ["p4"], ["p2", "p3"]]) {
      expect((await postSelection(selectionRequest(id, { punchIds: ids }), id, deps)).status).toBe(
        409,
      );
    }
    expect(await g.repo.listSelection(id)).toEqual(["p4", "p1"]);
  });

  it("гонка двух разных POST: принят один, второй 409, будим один раз", async () => {
    const { id, deps, resumeSelection } = await setup();
    const [a, b] = await Promise.all([
      postSelection(selectionRequest(id, { punchIds: ["p1", "p2"] }), id, deps),
      postSelection(selectionRequest(id, { punchIds: ["p3"] }), id, deps),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    expect(resumeSelection).toHaveBeenCalledTimes(1);
  });

  it("сбой пробуждения: 503, выбор остаётся, повтор того же выбора будит снова", async () => {
    const { id, deps, resumeSelection } = await setup();
    resumeSelection.mockRejectedValueOnce(new Error("hook not found"));
    const body = { punchIds: ["p1"] };
    expect((await postSelection(selectionRequest(id, body), id, deps)).status).toBe(503);
    expect((await postSelection(selectionRequest(id, body), id, deps)).status).toBe(202);
    expect(resumeSelection).toHaveBeenCalledTimes(2);
  });

  it("в логи при сбое только имя ошибки, без текста", async () => {
    const { id, deps, resumeSelection } = await setup();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    resumeSelection.mockRejectedValueOnce(new TypeError("Шутка номер 1"));
    await postSelection(selectionRequest(id, { punchIds: ["p1"] }), id, deps);
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("Шутка");
  });
});

describe("после выбора: draw, сборка и перенос в Кострище", () => {
  async function chosen(tier: 1 | 2) {
    const s = await setup({ tier });
    await postSelection(selectionRequest(s.id, { punchIds: ["p7", "p2", "p5"] }), s.id, s.deps);
    const art = makeArtifactRepo(s.g);
    const pipeline: PipelineDeps = {
      repo: s.g.repo,
      orders: s.t.orders.repo,
      now: () => NOW,
      write: async () => {},
    };
    const assembleDeps = {
      repo: s.g.repo,
      artifacts: art.repo,
      now: () => NOW,
      newSlug: () => "abcdefghij",
    };
    return { ...s, art, pipeline, assembleDeps };
  }

  it("Поджог: draw пропущен, артефакт из выбранных в порядке выбора, ready со slug", async () => {
    const { id, g, art, pipeline, assembleDeps } = await chosen(1);
    expect(await runDraw(pipeline, id)).toBe("skipped");
    expect(await runAssemble(assembleDeps, id)).toBe("ready");
    expect(g.rows.get(id)?.status).toBe("ready");
    expect((await g.repo.get(id))?.artifactSlug).toBe("abcdefghij");
    const saved = art.published[0];
    expect(saved?.content.punches.map((p) => p.id)).toEqual(["p7", "p2", "p5"]);
    expect(saved?.content.punches[0]?.text).toBe("Шутка номер 7");
    expect(saved?.ownerTokenHash).toBe(g.rows.get(id)?.ownerTokenHash);
  });

  it("Кострище: draw даёт drawing, затем сборка даёт ready", async () => {
    const { id, g, pipeline, assembleDeps } = await chosen(2);
    expect(await runDraw(pipeline, id)).toBe("done");
    expect(g.rows.get(id)?.status).toBe("drawing");
    expect(await runAssemble(assembleDeps, id)).toBe("ready");
    expect(g.rows.get(id)?.status).toBe("ready");
  });

  it("перенос из Поджога: выбранное попадает в кандидатов Кострища в порядке выбора", async () => {
    const { id, art } = await chosen(1);
    const selected = (await art.repo.loadInput(id))?.selected ?? [];
    expect(selected.map((p) => p.punchId)).toEqual(["p7", "p2", "p5"]);

    const saved: WrittenCandidate[] = [];
    const repo: WriteRepository = {
      hasCandidates: async () => false,
      loadInput: async () => ({
        tier: 2,
        level: "medium",
        mode: "self",
        extraFacts: [],
        trialGenerationId: id,
        snapshot: richRu(),
        persona: makePersona({}, 14),
      }),
      // Как настоящий `listSelected`: только выбранные, в порядке выбора.
      listSelected: async (trialId) =>
        trialId === id ? selected.map((p) => ({ ...p, trace: makeTrace() })) : [],
      saveCandidates: async (_id, candidates) => {
        saved.push(...candidates);
      },
      saveTrace: async () => {},
    };
    const writeDeps = makeWriteDeps();
    await runWriteStep("kostrishche", {
      repo,
      write: () => writeDeps,
      costs: { addStepCost: async () => {} },
    });
    expect(saved.filter((c) => c.fromTrial).map((c) => c.id)).toEqual(["p7", "p2", "p5"]);
  });

  it("собранный артефакт проходит схему Artifact целиком", async () => {
    const { id, art, assembleDeps } = await chosen(1);
    await runAssemble(assembleDeps, id);
    const published = art.published[0];
    const full = Artifact.parse({
      slug: published?.slug,
      kind: published?.kind,
      createdAt: NOW.toISOString(),
      subject: { username: "anya.travels", displayName: "Аня", avatarUrl: null },
      mode: "self",
      content: published?.content,
      punchImages: [],
      images: [],
      isOwner: false,
    });
    expect(full.kind).toBe("roast_v1");
  });
});
