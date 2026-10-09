import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoastContent } from "@/contracts";
import { jokesWord, newSlug, roastFrame, runAssemble, type AssembleDeps } from "./assemble";
import { createGeneration } from "./handlers";
import { makeArtifactRepo, makeDeps, NOW, post, TOKEN, URL_BODY } from "./test-helpers";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function setup(
  over: {
    status?: "awaiting_selection" | "drawing" | "failed" | "ready" | "writing";
    selection?: string[];
    profile?: unknown;
  } = {},
) {
  const t = makeDeps();
  const profileCheckId = await t.addCheck(TOKEN);
  await createGeneration(post({ ...URL_BODY, profileCheckId, tier: 1 }, { token: TOKEN }), t.deps);
  const id = "gen-1";
  const g = t.generations;
  g.addCandidates(
    id,
    Array.from({ length: 10 }, (_, i) => ({
      punchId: `p${i + 1}`,
      emoji: "🌅",
      text: `Шутка ${i + 1}`,
    })),
  );
  const row = g.rows.get(id);
  if (!row) throw new Error("нет строки");
  g.rows.set(id, { ...row, status: over.status ?? "awaiting_selection" });
  const selection = over.selection ?? ["p3", "p1"];
  for (const c of g.candidates.get(id) ?? []) {
    const i = selection.indexOf(c.punchId);
    c.selectionPosition = i === -1 ? null : i + 1;
  }
  const art = over.profile === undefined ? makeArtifactRepo(g) : makeArtifactRepo(g, over.profile);
  const deps: AssembleDeps = {
    repo: g.repo,
    artifacts: art.repo,
    now: () => NOW,
    newSlug: () => "AbCdEfGh12",
  };
  return { id, g, art, deps };
}

describe("runAssemble", () => {
  it("шутки и порядок из БД, ник из проверки профиля", async () => {
    const { id, art, deps } = await setup();
    expect(await runAssemble(deps, id)).toBe("ready");
    const saved = art.published[0];
    expect(saved).toMatchObject({
      generationId: id,
      slug: "AbCdEfGh12",
      kind: "roast_v1",
      images: [],
    });
    expect(RoastContent.parse(saved?.content).punches).toEqual([
      { id: "p3", emoji: "🌅", text: "Шутка 3" },
      { id: "p1", emoji: "🌅", text: "Шутка 1" },
    ]);
    expect(saved?.content.title).toBe("Прожарка @anya.travels");
    expect(saved?.subject).toEqual({
      username: "anya.travels",
      displayName: "Аня Морозова",
      avatarUrl: "https://abc123.public.blob.vercel-storage.com/avatars/abc",
    });
  });

  it("subject: аватар не https не пишется", async () => {
    const { id, art, deps } = await setup({
      profile: {
        username: "anya.travels",
        displayName: "Аня",
        avatarUrl: "javascript:alert(1)",
        postsCount: 1,
      },
    });
    expect(await runAssemble(deps, id)).toBe("ready");
    expect(art.published[0]?.subject).toEqual({
      username: "anya.travels",
      displayName: "Аня",
      avatarUrl: null,
    });
  });

  it("повтор после ready: ничего не пишет заново", async () => {
    const { id, art, deps } = await setup();
    await runAssemble(deps, id);
    expect(await runAssemble(deps, id)).toBe("ready");
    expect(art.published).toHaveLength(1);
  });

  it("закрытая снаружи (failed) генерация: артефакт не создаётся", async () => {
    const { id, art, deps } = await setup({ status: "failed" });
    expect(await runAssemble(deps, id)).toBe("closed");
    expect(art.repo.publish).not.toHaveBeenCalled();
  });

  it("гонка: закрыли между чтением и записью, итог closed", async () => {
    const { id, g, art, deps } = await setup();
    art.repo.publish.mockImplementationOnce(async () => {
      const row = g.rows.get(id);
      if (row) g.rows.set(id, { ...row, status: "failed" });
      return false;
    });
    expect(await runAssemble(deps, id)).toBe("closed");
  });

  it("пустой выбор и выбор сверх потолка тарифа: отказ без записи", async () => {
    for (const selection of [[], ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]]) {
      const { id, art, deps } = await setup({ selection });
      await expect(runAssemble(deps, id)).rejects.toMatchObject({
        name: "AssembleFailedError",
        reason: "bad_selection",
      });
      expect(art.repo.publish).not.toHaveBeenCalled();
    }
  });

  it("битый профиль: ник из генерации, сборка не падает", async () => {
    const { id, art, deps } = await setup({ profile: { мусор: 1 } });
    expect(await runAssemble(deps, id)).toBe("ready");
    expect(art.published[0]?.content.title).toBe("Прожарка @anya.travels");
  });

  it("неизвестная генерация: closed", async () => {
    const { deps } = await setup();
    expect(await runAssemble(deps, "nope")).toBe("closed");
  });

  it("не прошёл схему Artifact (slug не 10 символов): отказ до записи", async () => {
    const { id, art, deps } = await setup();
    await expect(runAssemble({ ...deps, newSlug: () => "short" }, id)).rejects.toMatchObject({
      reason: "invalid_artifact",
    });
    expect(art.repo.publish).not.toHaveBeenCalled();
  });
});

describe("newSlug и roastFrame", () => {
  it("slug: 10 символов a-zA-Z0-9, не повторяется", () => {
    const slugs = new Set(Array.from({ length: 200 }, newSlug));
    expect(slugs.size).toBe(200);
    for (const s of slugs) expect(s).toMatch(/^[a-zA-Z0-9]{10}$/);
  });

  it("текст шеринга не длиннее 140 знаков даже при длинном нике", () => {
    expect(roastFrame("a".repeat(30), 6, "friend").shareText.length).toBeLessThanOrEqual(140);
  });

  it("число шуток склоняется по-русски", () => {
    expect([1, 2, 4, 5, 6, 11, 12, 14, 21, 22, 25].map(jokesWord)).toEqual([
      "1 шутка",
      "2 шутки",
      "4 шутки",
      "5 шуток",
      "6 шуток",
      "11 шуток",
      "12 шуток",
      "14 шуток",
      "21 шутка",
      "22 шутки",
      "25 шуток",
    ]);
    expect(roastFrame("a", 1, "self").tagline).toBe("Выбрано вручную: 1 шутка про @a");
  });
});
