import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidatesResponse } from "@/contracts";
import { CANARIES } from "../prompts/canary";
import { PunchTraceSchema } from "../roast/write/schema";
import { WriteFailedError } from "../roast/write/types";
import { ComedyFailedError, writeComedyCandidates } from "./engine";
import { ComedyTrace } from "./trace";
import {
  comedyInput,
  fakeEditor,
  fakeInsights,
  fakeModerator,
  fakeProfile,
  fakePunch,
  makeComedyDeps,
  makeMaterial,
  profileAnswer,
  PROFILE_FACTS,
  snapshotSource,
  userText,
} from "./test-helpers";
import type { CarriedPunch } from "../roast/write/types";
import type { ComedyGenerateFn } from "./types";
import { MODERATION_PASSES } from "./config";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof WriteFailedError ? e : null;
  }
  return null;
};

const carriedPunch = (id: string, text: string): CarriedPunch => ({
  id,
  emoji: "🔥",
  text,
  trace: {
    hookId: "A1",
    mechanism: "meta",
    evidenceRef: "post:0",
    jokeCardId: null,
    scores: null,
    totalScore: 20,
    tastePack: "comedy/v1",
    promptVersion: "comedy/punch-v1",
    writerModel: "m",
    judgeModel: "m",
  },
});

describe("writeComedyCandidates: счастливый путь", () => {
  it("Поджог: 10 шуток, уникальные id, контракт, трасса кандидата comedy", async () => {
    const r = await writeComedyCandidates(comedyInput({ tier: 1 }), makeComedyDeps());
    expect(r.candidates).toHaveLength(10);
    expect(
      CandidatesResponse.safeParse({
        generationId: "g",
        selectCount: 6,
        candidates: r.candidates.map((c) => ({ id: c.id, emoji: c.emoji, text: c.text })),
      }).success,
    ).toBe(true);
    expect(r.promptVersion).toBe("comedy/punch-v1");
    expect(r.tastePack).toBe("comedy/v1");
    expect(r.moderator).toEqual({ promptVersion: "comedy/moderator-v1", model: "test-moderator" });
    const t = r.candidates[0]!.trace;
    expect(t.structure).toBe("false_compliment");
    expect(t.mechanism).toBe("faux_compliment");
    expect(t.insightId).toBe(t.hookId);
    expect(t.totalScore).toBe(20);
    expect(t.jokeCardId).toBeNull();
    expect([t.writerModel, t.judgeModel]).toEqual(["test-punch", "test-editor"]);
    expect(t.evidenceRef).toMatch(/^post:\d$/);
    expect(PunchTraceSchema.parse(t).structure).toBe("false_compliment");
    // Поджог: не больше одной шутки на инсайт.
    expect(new Set(r.candidates.map((c) => c.trace.insightId)).size).toBe(10);
  });

  it("Кострище: 20 шуток, не больше двух на инсайт", async () => {
    const r = await writeComedyCandidates(comedyInput({ tier: 2 }), makeComedyDeps());
    expect(r.candidates).toHaveLength(20);
    const perInsight = new Map<string, number>();
    for (const c of r.candidates) {
      perInsight.set(c.trace.hookId, (perInsight.get(c.trace.hookId) ?? 0) + 1);
    }
    expect(Math.max(...perInsight.values())).toBeLessThanOrEqual(2);
  });

  it("трасса шага comedy: профиль, инсайты, отбор, кандидаты с исходом, версии и тайминги", async () => {
    const r = await writeComedyCandidates(comedyInput({ tier: 1 }), makeComedyDeps());
    const trace = ComedyTrace.parse(r.trace);
    expect(trace.result).toBe("ok");
    expect(trace.material).toMatchObject({ source: "agent-reach", posts: 3 });
    expect(trace.material?.images).toEqual(["avatar", "post:0"]);
    expect(trace.profile?.facts[0]?.id).toBe("F1");
    expect(trace.profile?.quotes[0]?.id).toBe("Q1");
    expect(trace.insights.map((i) => i.id)).toContain("B1");
    expect(trace.selection?.work).toHaveLength(10);
    expect(trace.selection?.reserve).toHaveLength(5);
    expect(trace.prompts.profile).toBe("comedy/profile-v1");
    expect(trace.models).toMatchObject({ profile: "test-profile", moderator: "test-moderator" });
    const chosen = trace.candidates.filter((c) => c.outcome === "chosen");
    expect(chosen.map((c) => c.punchId).sort()).toEqual(r.candidates.map((c) => c.id).sort());
    expect(trace.candidates.some((c) => c.outcome === "reserve")).toBe(true);
    for (const key of [
      "material",
      "profile",
      "insights",
      "select",
      "punch",
      "editor",
      "moderator",
      "total",
    ]) {
      expect(trace.timingsMs[key]).toBeGreaterThan(0);
    }
  });

  it("одна строка лога на генерацию, без текстов шуток и профиля", async () => {
    await writeComedyCandidates(comedyInput(), makeComedyDeps());
    const lines = vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .filter((l) => l.startsWith("[comedy] итог="));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("итог=ok");
    expect(lines[0]).not.toMatch(/шейкер|Шейкер|Зеркало|Дисциплина|Кирилл/);
  });
});

describe("материал", () => {
  it("снимок без картинок: fetchCovers не зовётся, факты заказчика в блоке обезврежены", async () => {
    const fetchCovers = vi.fn(async () => []);
    const profile = fakeProfile();
    const deps = makeComedyDeps({ fetchCovers, profile });
    await writeComedyCandidates(
      comedyInput({ source: snapshotSource(), extraFacts: ["любит <b>бегать</b>"] }),
      deps,
    );
    expect(fetchCovers).not.toHaveBeenCalled();
    const text = userText(profile.mock.calls[0]![0]);
    expect(text).toContain("<profile_data>");
    expect(text).toContain("любит ‹b›бегать‹/b›");
    expect(text).toContain("Картинок нет");
  });

  it("снимок с обложками и аватаром: качаются через fetchCovers, уходят в vision с подписями", async () => {
    const src = snapshotSource();
    if (src.kind !== "snapshot") throw new Error("kind");
    const snapshot = {
      ...src.snapshot,
      avatarUrl: "https://scontent.cdninstagram.com/a.jpg",
      posts: src.snapshot.posts.map((p, i) => ({
        ...p,
        imageUrl: `https://scontent.cdninstagram.com/p${i}.jpg`,
      })),
    };
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0]);
    const fetchCovers = vi.fn(async (covers: readonly { index: number; url: string }[]) =>
      covers.map((c) => ({ ...c, data: jpeg, mediaType: "image/jpeg" as const })),
    );
    const profile = fakeProfile();
    await writeComedyCandidates(
      comedyInput({ source: { ...src, snapshot } }),
      makeComedyDeps({ fetchCovers, profile }),
    );
    const asked = fetchCovers.mock.calls[0]![0];
    expect(asked[0]).toEqual({ index: -1, url: "https://scontent.cdninstagram.com/a.jpg" });
    expect(asked.length).toBe(Math.min(12, snapshot.posts.length) + 1);
    const prompt = profile.mock.calls[0]![0];
    expect(prompt.parts.filter((p) => p.type === "image")).toHaveLength(asked.length);
    expect(userText(prompt)).toContain("Аватар");
    expect(userText(prompt)).toMatch(/Картинка поста post:\d+/);
  });
});

describe("профиль", () => {
  it("minorSignals: bad_input сразу, дальше моделей не зовём, трасса провала", async () => {
    const deps = makeComedyDeps({ profile: fakeProfile(profileAnswer({ minorSignals: true })) });
    const e = await failure(writeComedyCandidates(comedyInput(), deps));
    expect(e?.reason).toBe("bad_input");
    expect(deps.profile).toHaveBeenCalledTimes(1);
    expect(deps.insights).not.toHaveBeenCalled();
    expect(e).toBeInstanceOf(ComedyFailedError);
    const trace = ComedyTrace.parse((e as ComedyFailedError).comedyTrace);
    expect(trace).toMatchObject({ result: "failed", failure: "bad_input" });
  });

  it("minorSignals при кривом остальном ответе: всё равно bad_input без ретраев", async () => {
    const deps = makeComedyDeps({ profile: fakeProfile({ minorSignals: true, facts: "мусор" }) });
    expect((await failure(writeComedyCandidates(comedyInput(), deps)))?.reason).toBe("bad_input");
    expect(deps.profile).toHaveBeenCalledTimes(1);
  });

  it("второстепенные поля профиля кривые: запасные значения, без ретрая", async () => {
    const answer = profileAnswer({
      coverage: { appearance: "много" },
      ownHumor: 42,
      keyObservation: "   ",
      person: { callName: null, gender: "робот", ageStated: null },
    });
    const deps = makeComedyDeps({ profile: fakeProfile(answer) });
    const r = await writeComedyCandidates(comedyInput(), deps);
    expect(deps.profile).toHaveBeenCalledTimes(1);
    const p = ComedyTrace.parse(r.trace).profile!;
    expect(p.person.gender).toBe("unknown");
    expect(p.coverage.appearance).toBe(0);
    expect(p.ownHumor).toBeNull();
    expect(p.keyObservation).toBe("(нет)");
  });

  it("пустые ответы всех категорий инсайтов: ретраи и llm_failed", async () => {
    const insights = vi.fn<ComedyGenerateFn>(async () => ({ insights: [] }));
    const deps = makeComedyDeps({ insights });
    expect((await failure(writeComedyCandidates(comedyInput(), deps)))?.reason).toBe("llm_failed");
    expect(insights).toHaveBeenCalledTimes(9);
    expect(deps.punch).not.toHaveBeenCalled();
  });

  it("не та степень: bad_input до любого вызова", async () => {
    const deps = makeComedyDeps();
    const e = await failure(writeComedyCandidates(comedyInput({ level: "medium" }), deps));
    expect(e?.reason).toBe("bad_input");
    expect(deps.profile).not.toHaveBeenCalled();
  });

  it("ответ не по схеме: ретрай с причиной; сбой вызова: следующая попытка без картинок", async () => {
    let call = 0;
    const profile = vi.fn<ComedyGenerateFn>(async () => {
      call++;
      if (call === 1) return { nope: true };
      if (call === 2) throw new Error("сеть");
      return profileAnswer();
    });
    await writeComedyCandidates(comedyInput(), makeComedyDeps({ profile }));
    expect(profile).toHaveBeenCalledTimes(3);
    const [first, second, third] = profile.mock.calls.map((c) => c[0]);
    expect(first!.parts.some((p) => p.type === "image")).toBe(true);
    expect(userText(second!)).toContain("Предыдущий ответ не принят");
    expect(third!.parts.some((p) => p.type === "image")).toBe(false);
  });

  it("кривые факты выбрасываются, id ставит код; меньше 5 фактов — ретраи и llm_failed", async () => {
    const answer = profileAnswer();
    answer.facts = [
      ...answer.facts,
      { section: "космос", text: "x", source: "post:1", basis: "seen" },
      { section: "habits", text: "   ", source: "post:1", basis: "seen" },
    ];
    const r = await writeComedyCandidates(
      comedyInput(),
      makeComedyDeps({ profile: fakeProfile(answer) }),
    );
    const trace = ComedyTrace.parse(r.trace);
    expect(trace.profile?.facts).toHaveLength(PROFILE_FACTS);
    expect(trace.profile?.facts.map((f) => f.id).at(-1)).toBe(`F${PROFILE_FACTS}`);

    const thin = makeComedyDeps({ profile: fakeProfile(profileAnswer({}, 3)) });
    expect((await failure(writeComedyCandidates(comedyInput(), thin)))?.reason).toBe("llm_failed");
    expect(thin.profile).toHaveBeenCalledTimes(3);
  });

  it("PII из текста на картинках вырезается из профиля: дальше ни в промпты, ни в трассу", async () => {
    const answer = profileAnswer({
      person: { callName: "Кирилл +7 999 123-45-67", gender: "male", ageStated: null },
      quotes: [
        {
          text: "Запись: +7 (999) 123-45-67, пиши kirill@mail.ru",
          source: "cover:0",
          about: "запись",
        },
      ],
      keyObservation: "Зовёт в студию на ул. Ленина, 5 и на taplink.cc/kirill",
    });
    answer.facts = [
      {
        section: "work_money",
        text: "На обложке номер 8 999 123 45 67",
        source: "cover:1",
        basis: "seen",
      },
      ...answer.facts,
    ];
    const deps = makeComedyDeps({ profile: fakeProfile(answer) });
    const r = await writeComedyCandidates(comedyInput(), deps);
    const seen = [
      JSON.stringify(ComedyTrace.parse(r.trace).profile),
      ...[deps.insights, deps.select, deps.punch].map((fn) =>
        userText(vi.mocked(fn).mock.calls[0]![0]),
      ),
    ].join("\n");
    for (const pii of ["123-45-67", "123 45 67", "mail.ru", "Ленина", "taplink"]) {
      expect(seen).not.toContain(pii);
    }
    expect(seen).toContain("Запись:");
    expect(seen).toContain("На обложке номер");
  });

  it("закрытые темы профиля и досье уходят списком «нельзя» в инсайты, генератор и модератор", async () => {
    const deps = makeComedyDeps({
      profile: fakeProfile(profileAnswer({ closedTopics: ["здоровье мамы"] })),
    });
    await writeComedyCandidates(comedyInput({ forbidden: ["бывший муж"] }), deps);
    for (const fn of [deps.insights, deps.punch, deps.moderator]) {
      const text = userText(vi.mocked(fn).mock.calls[0]![0]);
      expect(text).toContain("здоровье мамы");
      expect(text).toContain("бывший муж");
    }
  });
});

describe("инсайты и отбор", () => {
  it("неизвестные factIds вычёркиваются, инсайт без опоры удаляется, id ставит код", async () => {
    const insights = vi.fn(async () => ({
      insights: [
        {
          title: "Без опоры",
          factIds: ["F99"],
          insight: "x",
          directions: [],
          potential: 5,
          risk: null,
        },
        ...Array.from({ length: 12 }, (_, i) => ({
          title: `Ок ${i}`,
          factIds: [`[f${i + 1}]`, "F77"],
          insight: "Сталкиваем",
          directions: ["a", "b", "c", "d"],
          potential: 3,
          risk: null,
        })),
      ],
    }));
    const r = await writeComedyCandidates(comedyInput(), makeComedyDeps({ insights }));
    const trace = ComedyTrace.parse(r.trace);
    const a = trace.insights.filter((i) => i.category === "A");
    expect(a[0]).toMatchObject({ id: "A1", factIds: ["F1"], title: "Ок 0" });
    expect(a.every((i) => i.directions.length <= 3)).toBe(true);
    expect(trace.insights.some((i) => i.title === "Без опоры")).toBe(false);
  });

  it("категория, исчерпавшая ретраи, отпадает; остальные работают", async () => {
    const good = fakeInsights(8);
    const insights = vi.fn(async (p: Parameters<typeof good>[0]) => {
      if (userText(p).includes("категории B")) throw new Error("сеть");
      return good(p);
    });
    const r = await writeComedyCandidates(comedyInput(), makeComedyDeps({ insights }));
    const trace = ComedyTrace.parse(r.trace);
    expect(trace.insights.some((i) => i.category === "B")).toBe(false);
    expect(r.candidates.length).toBe(10);
  });

  it("отбор: чужие id, повторы и одинаковая связка фактов выбывают; недобор добирает код", async () => {
    const select = vi.fn(async () => ({
      picks: [
        { id: "A1", theme: "деньги", mechanic: "гипербола", score: 9 },
        { id: "a1", theme: "повтор", mechanic: "гипербола", score: 9 },
        { id: "Z9", theme: "чужой", mechanic: "гипербола", score: 9 },
        { id: "B1", theme: "усы", mechanic: "гипербола", score: 8 },
      ],
    }));
    const r = await writeComedyCandidates(comedyInput(), makeComedyDeps({ select }));
    const sel = ComedyTrace.parse(r.trace).selection!;
    expect(sel.picks.slice(0, 2).map((p) => p.id)).toEqual(["A1", "B1"]);
    expect(sel.picks).toHaveLength(15);
    expect(sel.toppedUp).toBe(13);
    expect(new Set(sel.picks.map((p) => p.id)).size).toBe(15);
  });

  it("отбор упал целиком: ранжир кодом, генерация не падает", async () => {
    const select = vi.fn(async () => {
      throw new Error("сеть");
    });
    const r = await writeComedyCandidates(comedyInput(), makeComedyDeps({ select }));
    expect(select).toHaveBeenCalledTimes(3);
    expect(r.candidates).toHaveLength(10);
    expect(ComedyTrace.parse(r.trace).selection?.toppedUp).toBe(15);
  });
});

describe("генератор: проверки кодом и слой 4", () => {
  it("длиннее 200, не по-русски, чужой инсайт, тире и canary вычёркиваются; 200 проходит", async () => {
    const long200 = `Шейкер ${"я".repeat(193)}`;
    const punch = fakePunch((id, n, call) => {
      if (id === "A1" && n === 1) return `${"я".repeat(201)}`;
      if (id === "A1" && n === 2) return "English only joke about the mirror";
      if (id === "A2" && n === 1) return "Шейкер — лучший друг, блядь";
      if (id === "A2" && n === 2) return `Шейкер у тебя в каждом кадре ${CANARIES.writer} блядь`;
      if (id === "A3" && n === 2)
        return "Кресло под тобой единственное, которое после шоу выкинут нахуй";
      if (id === "A3" && n === 1) return long200;
      return `Зеркало номер ${id} вызов ${call} вариант ${n}, блядь`;
    });
    const r = await writeComedyCandidates(comedyInput({ tier: 2 }), makeComedyDeps({ punch }));
    const trace = ComedyTrace.parse(r.trace);
    const reasons = trace.candidates
      .filter((c) => c.outcome === "dropped_layer4")
      .map((c) => c.reason);
    expect(reasons).toEqual(
      expect.arrayContaining(["too_long", "not_russian", "long_dash", "prompt_leak"]),
    );
    const leaks = trace.candidates.filter((c) => c.reason === "prompt_leak");
    // Canary и цепочка слов из промпта генератора (его образец темпа): текст в трассу не кладём.
    expect(leaks).toHaveLength(2);
    expect(leaks.every((c) => c.text === null)).toBe(true);
    expect(trace.candidates.some((c) => c.text === long200 && c.outcome !== "dropped_layer4")).toBe(
      true,
    );
    expect(r.stats.droppedInvalid).toBeGreaterThanOrEqual(4);
    expect(trace.filters.layer4.too_long).toBe(1);
  });

  it("дефис с пробелами между словами — spaced_hyphen; диапазон цифр «5 - 7» проходит", async () => {
    const punch = fakePunch((id, n, call) =>
      n === 1
        ? `Шейкер ${id} у тебя в каждом кадре - видно, ебучий тренер`
        : n === 2
          ? `От 5 - 7 шейкеров в кадре ${id} вызов ${call}, охуенно`
          : `Зеркало ${id} вызов ${call} вариант ${n}, блядь`,
    );
    const r = await writeComedyCandidates(comedyInput({ tier: 2 }), makeComedyDeps({ punch }));
    const trace = ComedyTrace.parse(r.trace);
    const hyphen = trace.candidates.filter((c) => c.reason === "spaced_hyphen");
    expect(hyphen.length).toBeGreaterThan(0);
    expect(hyphen.every((c) => c.outcome === "dropped_layer4" && c.text?.includes(" - "))).toBe(
      true,
    );
    expect(trace.filters.layer4.spaced_hyphen).toBe(hyphen.length);
    expect(r.stats.droppedInvalid).toBeGreaterThanOrEqual(hyphen.length);
    expect(trace.candidates.some((c) => c.text?.startsWith("От 5 - 7") && !c.reason)).toBe(true);
  });

  it("чужой insightId — unknown_hook; дубль по тексту, в том числе с карри из Поджога", async () => {
    const carried = [carriedPunch("t1", "Карри из Поджога, блядь")];
    const punch = vi.fn(async (p: Parameters<ReturnType<typeof fakePunch>>[0]) => {
      const base = (await fakePunch()(p)) as { punches: Record<string, unknown>[] };
      return {
        punches: [
          { insightId: "Z1", structure: "other", emoji: "🔥", text: "Чужой инсайт, блядь" },
          { ...base.punches[0], text: "Карри из поджога блядь!" },
          ...base.punches,
        ],
      };
    });
    const r = await writeComedyCandidates(
      comedyInput({ tier: 2, carried }),
      makeComedyDeps({ punch }),
    );
    const trace = ComedyTrace.parse(r.trace);
    expect(trace.filters.layer4.unknown_hook).toBeGreaterThanOrEqual(1);
    expect(trace.filters.layer4.duplicate).toBeGreaterThanOrEqual(1);
    expect(r.candidates[0]).toMatchObject({ id: "t1", fromTrial: true });
    expect(r.candidates.filter((c) => c.text.startsWith("Карри"))).toHaveLength(1);
  });

  it("запретная тема досье в тексте шутки вычёркивается кодом (avoid_topic)", async () => {
    const punch = fakePunch((id, n, call) =>
      n === 1
        ? `Твой клуб Титан видно даже на ${id}, блядь`
        : `Зеркало ${id} вызов ${call} вариант ${n}, блядь`,
    );
    const r = await writeComedyCandidates(
      comedyInput({ forbidden: ["клуб «Титан»"] }),
      makeComedyDeps({ punch }),
    );
    expect(ComedyTrace.parse(r.trace).filters.layer4.avoid_topic).toBeGreaterThan(0);
    expect(r.candidates.every((c) => !c.text.includes("Титан"))).toBe(true);
  });

  it("пустой ответ генератора: ретраи с причиной, затем llm_failed", async () => {
    const punch = vi.fn<ComedyGenerateFn>(async () => ({ punches: [] }));
    const e = await failure(writeComedyCandidates(comedyInput(), makeComedyDeps({ punch })));
    expect(e?.reason).toBe("llm_failed");
    // 10 инсайтов по 3 на вызов: 4 пачки (3+3+3+1), по три попытки.
    expect(punch).toHaveBeenCalledTimes(12);
    const notes = punch.mock.calls.filter(([p]) =>
      userText(p).includes("ни одна шутка не принята"),
    );
    expect(notes).toHaveLength(8);
  });
});

describe("редактор", () => {
  it("broken и ясность ниже 2 не берутся, без оценки — dropped_editor, лишние id игнорируются", async () => {
    const editor = fakeEditor(
      (id) => (id === "c1" ? { broken: true } : id === "c2" ? { clarity: 1 } : {}),
      (ids, n) => ["c1", "c2", "c999", ...ids.slice(2, n + 2)],
    );
    const skipOne = vi.fn(async (p: Parameters<typeof editor>[0]) => {
      const out = (await editor(p)) as { scores: { id: string }[]; picked: string[] };
      return { ...out, scores: out.scores.filter((s) => s.id !== "c3") };
    });
    const r = await writeComedyCandidates(comedyInput(), makeComedyDeps({ editor: skipOne }));
    const trace = ComedyTrace.parse(r.trace);
    const reasons = trace.candidates
      .filter((c) => c.outcome === "dropped_editor")
      .map((c) => c.reason);
    expect(reasons).toEqual(expect.arrayContaining(["broken", "clarity", "no_score"]));
    expect(r.stats.droppedByJudge).toBe(2);
    expect(r.stats.unscored).toBe(1);
    expect(r.candidates).toHaveLength(10);
  });

  it("пустой picked: добор по сумме оценок с ограничением на инсайт", async () => {
    const editor = fakeEditor(
      (id) => ({ surprise: Number(id.slice(1)) % 6 }),
      () => [],
    );
    const r = await writeComedyCandidates(comedyInput(), makeComedyDeps({ editor }));
    expect(r.candidates).toHaveLength(10);
    expect(new Set(r.candidates.map((c) => c.trace.insightId)).size).toBe(10);
  });

  it("повтор уже взятой шутки (duplicateOf) не добирается", async () => {
    const editor = fakeEditor(
      (id) => (id === "c2" ? { duplicateOf: "c1", surprise: 5 } : {}),
      () => ["c1"],
    );
    const r = await writeComedyCandidates(comedyInput({ tier: 2 }), makeComedyDeps({ editor }));
    const trace = ComedyTrace.parse(r.trace);
    const second = trace.candidates.filter(
      (c) => c.round === 1 && c.outcome !== "dropped_layer4",
    )[1];
    expect(second?.outcome).toBe("reserve");
  });
});

describe("модератор", () => {
  it("закрытая тема и непонятная вычёркиваются, вычеркнутых заменяет добор", async () => {
    // Первые две шутки первого прохода: одна про закрытую тему, другая непонятная.
    const verdictFor = new Map<string, Partial<Record<string, boolean>>>();
    const moderator = fakeModerator((_id, text) => {
      if (!verdictFor.has(text)) {
        const n = verdictFor.size;
        verdictFor.set(
          text,
          n === 0 ? { hitsClosedTopic: true } : n === 1 ? { selfContained: false } : {},
        );
      }
      return verdictFor.get(text)!;
    });
    const r = await writeComedyCandidates(comedyInput(), makeComedyDeps({ moderator }));
    expect(r.candidates).toHaveLength(10);
    expect(r.stats.droppedByModerator).toBe(2);
    const trace = ComedyTrace.parse(r.trace);
    expect(trace.filters.layer5).toMatchObject({ forbidden_topic: 1, unclear: 1 });
    expect(trace.filters.moderatorPasses).toBe(2);
  });

  it("10 нужно, модератор режет 4, запас только у тех же инсайтов: третий проход без ограничения", async () => {
    // A1 и A2 модератор режет целиком, у A3 и A4 только первую шутку. Шутки A1 и A2 слабее.
    const verdict = (text: string) => {
      const m = /номер (\w+) вызов \d+ вариант (\d)/.exec(text);
      const [id, n] = [m?.[1], m?.[2]];
      const doomed = id === "A1" || id === "A2" || ((id === "A3" || id === "A4") && n === "1");
      return doomed ? { hitsClosedTopic: true } : {};
    };
    const editor = fakeEditor((_id, text) =>
      /номер A[12] /.test(text) ? { surprise: 1 } : { surprise: 4 },
    );
    const deps = makeComedyDeps({ moderator: fakeModerator((_id, text) => verdict(text)), editor });
    const r = await writeComedyCandidates(comedyInput({ tier: 1 }), deps);
    expect(r.candidates).toHaveLength(10);
    expect(r.stats.droppedByModerator).toBe(6);
    const trace = ComedyTrace.parse(r.trace);
    expect(trace.filters.moderatorPasses).toBe(3);
    expect(trace.rounds).toHaveLength(1);
    // Добраны шутки инсайтов, у которых уже есть выбранная: ограничение на инсайт снято.
    const perInsight = new Map<string, number>();
    for (const c of r.candidates) {
      perInsight.set(c.trace.hookId, (perInsight.get(c.trace.hookId) ?? 0) + 1);
    }
    expect(Math.max(...perInsight.values())).toBe(2);
    expect(r.candidates.some((c) => /номер A[12] /.test(c.text))).toBe(false);
  });

  it("нет вердикта — кандидат вычеркнут (unmoderated)", async () => {
    const moderator = vi.fn(async (p: Parameters<ReturnType<typeof fakeModerator>>[0]) => {
      const out = (await fakeModerator()(p)) as { verdicts: { id: string }[] };
      return { verdicts: out.verdicts.filter((v) => v.id !== "m1") };
    });
    const r = await writeComedyCandidates(comedyInput(), makeComedyDeps({ moderator }));
    expect(r.stats.unmoderated).toBeGreaterThanOrEqual(1);
    const trace = ComedyTrace.parse(r.trace);
    expect(trace.candidates.some((c) => c.outcome === "unmoderated")).toBe(true);
  });
});

describe("раунд 2 и недобор", () => {
  it("после модератора меньше 8: раунд 2 по запасным инсайтам с «уже написано»", async () => {
    let calls = 0;
    const moderator = vi.fn(async (p: Parameters<ReturnType<typeof fakeModerator>>[0]) => {
      calls++;
      // Раунд 1 (все проходы, по вызову на проход): вычёркиваем всё.
      return fakeModerator(() => (calls <= MODERATION_PASSES ? { hitsClosedTopic: true } : {}))(p);
    });
    const deps = makeComedyDeps({ moderator });
    const r = await writeComedyCandidates(comedyInput(), deps);
    const trace = ComedyTrace.parse(r.trace);
    expect(trace.rounds.map((x) => x.round)).toEqual([1, 2]);
    expect(trace.rounds[1]?.insightIds).toEqual(trace.selection?.reserve);
    expect(r.stats.rounds).toBe(2);
    const lastPunch = vi.mocked(deps.punch).mock.calls.at(-1)![0];
    expect(userText(lastPunch)).toContain("Уже написано");
    expect(r.candidates.length).toBeGreaterThanOrEqual(5);
  });

  it("и после раунда 2 меньше минимума: not_enough_candidates, трасса провала", async () => {
    const moderator = fakeModerator(() => ({ hitsClosedTopic: true }));
    const e = await failure(writeComedyCandidates(comedyInput(), makeComedyDeps({ moderator })));
    expect(e?.reason).toBe("not_enough_candidates");
    const trace = ComedyTrace.parse((e as ComedyFailedError).comedyTrace);
    expect(trace.result).toBe("failed");
    expect(trace.rounds).toHaveLength(2);
    expect(trace.candidates.every((c) => c.outcome !== "chosen")).toBe(true);
  });

  it("Кострище с карри: перенесённые первыми, редактор видит их в «уже выбрано»", async () => {
    const carried = [carriedPunch("t1", "Шутка из Поджога про шейкер, блядь")];
    const deps = makeComedyDeps();
    const r = await writeComedyCandidates(comedyInput({ tier: 2, carried }), deps);
    expect(r.candidates[0]).toMatchObject({ id: "t1", fromTrial: true });
    expect(r.candidates.filter((c) => !c.fromTrial)).toHaveLength(20);
    const editorText = userText(vi.mocked(deps.editor).mock.calls[0]![0]);
    expect(editorText).toMatch(/<already_chosen>\n- Шутка из Поджога/);
    expect(ComedyTrace.parse(r.trace).carriedPunchIds).toEqual(["t1"]);
  });
});

describe("без картинок", () => {
  it("материал без картинок: профиль без vision-частей", async () => {
    const deps = makeComedyDeps();
    await writeComedyCandidates(
      comedyInput({ source: { kind: "material", material: makeMaterial({ images: [] }) } }),
      deps,
    );
    const prompt = vi.mocked(deps.profile).mock.calls[0]![0];
    expect(prompt.parts.some((p) => p.type === "image")).toBe(false);
    expect(userText(prompt)).toContain("Картинок нет");
  });
});
