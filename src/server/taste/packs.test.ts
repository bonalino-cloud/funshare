import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as active from "../prompts/active";
import { allWriteSystemPrompts } from "../prompts/registry";
import { pickStyles } from "../roast/write/bank";
import { selectHooks } from "../roast/write/hooks";
import { PunchTraceSchema } from "../roast/write/schema";
import {
  fakeJudge,
  fakeModerator,
  fakeWriter,
  inputBase,
  makeBank,
  makePersona,
  makeWriteDeps,
} from "../roast/write/test-helpers";
import { WriteTrace } from "../roast/write/trace";
import { WriteFailedError } from "../roast/write/types";
import { writeCandidates } from "../roast/write/write-candidates";
import {
  CURRENT_TASTE_PACK,
  getTastePack,
  listTastePacks,
  registerTastePack,
  unregisterTastePack,
  UnknownTastePackError,
  type TastePack,
} from "./index";

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Всё, что пакет выдаёт по степеням и режимам, хешами; одна функция на пакет и на `active`. */
function render(src: {
  writerSystem: TastePack["writer"]["buildSystem"];
  writer: TastePack["writer"]["buildPrompt"];
  judgeSystem: string;
  judge: TastePack["judge"]["buildPrompt"];
  moderatorSystem: string;
  moderator: TastePack["moderator"]["buildPrompt"];
  versions: string;
}) {
  const out: Record<string, string> = {};
  const persona = makePersona({}, 8);
  for (const level of ["rare", "medium", "well_done"] as const) {
    for (const mode of ["self", "friend"] as const) {
      const hooks = selectHooks(persona, level, 1);
      const styles = pickStyles(hooks, level, makeBank());
      const w = src.writer({
        ...inputBase({ persona, level, mode, extraFacts: ["любит бегать"] }),
        styles,
        alreadyWritten: ["Старая"],
        retryNote: "мало русского",
      });
      out[`writer/${level}/${mode}/system`] = sha(w.system);
      out[`writer/${level}/${mode}/user`] = sha(w.user);
      out[`writerSystem/${level}/${mode}`] = sha(src.writerSystem(level, mode));
      const j = src.judge({
        hooks,
        candidates: [{ id: "c1", hookId: hooks[0]!.id, text: "Шутка один" }],
        level,
        mode,
        retryNote: "note",
      });
      out[`judge/${level}/${mode}/system`] = sha(j.system);
      out[`judge/${level}/${mode}/user`] = sha(j.user);
      const m = src.moderator({
        candidates: [{ id: "m1", text: "Шутка один" }],
        forbidden: ["болезни"],
        level,
        mode,
        retryNote: "note",
      });
      out[`moderator/${level}/${mode}/system`] = sha(m.system);
      out[`moderator/${level}/${mode}/user`] = sha(m.user);
    }
  }
  out["JUDGE_SYSTEM"] = sha(src.judgeSystem);
  out["MODERATOR_SYSTEM"] = sha(src.moderatorSystem);
  out["versions"] = src.versions;
  return out;
}

const fromPack = (p: TastePack) =>
  render({
    writerSystem: p.writer.buildSystem,
    writer: p.writer.buildPrompt,
    judgeSystem: p.judge.system,
    judge: p.judge.buildPrompt,
    moderatorSystem: p.moderator.system,
    moderator: p.moderator.buildPrompt,
    versions: `${p.writer.version}|${p.moderator.version}`,
  });

describe("taste/v1 = текущие промпты", () => {
  it("текущий пакет это taste/v1", () => {
    expect(CURRENT_TASTE_PACK).toBe("taste/v1");
    expect(getTastePack().name).toBe("taste/v1");
  });

  it("совпадает с prompts/active на всех степенях и режимах", () => {
    const old = render({
      writerSystem: active.buildWriterSystem,
      writer: active.buildWriterPrompt,
      judgeSystem: active.JUDGE_SYSTEM,
      judge: active.buildJudgePrompt,
      moderatorSystem: active.MODERATOR_SYSTEM,
      moderator: active.buildModeratorPrompt,
      versions: `${active.ROAST_PROMPT_VERSION}|${active.MODERATOR_PROMPT_VERSION}`,
    });
    expect(fromPack(getTastePack("taste/v1"))).toEqual(old);
  });

  // Снят ДО рефакторинга со старого `prompts/active` (roast/v2, moderator-v2). Упал: тексты
  // промптов поменялись. Намеренный откат или правка: `vitest -u` и запись в ретро.
  it("снимок байтов (sha256) старого поведения", () => {
    expect(fromPack(getTastePack("taste/v1"))).toMatchSnapshot();
  });

  it("версии промптов roast/vN не смешаны с именем пакета", () => {
    const p = getTastePack("taste/v1");
    expect([p.writer.version, p.judge.version, p.moderator.version]).toEqual([
      "roast/v2",
      "roast/v2",
      "roast/moderator-v2",
    ]);
  });

  // Каждый встроенный пакет: иначе слой 4 не поймает утечку промпта нового пакета (prompt_leak).
  it("реестр утечек знает системные промпты каждого пакета", () => {
    const known = allWriteSystemPrompts();
    for (const name of listTastePacks()) {
      const p = getTastePack(name);
      expect(known).toContain(p.judge.system);
      expect(known).toContain(p.moderator.system);
      for (const level of ["rare", "medium", "well_done"] as const) {
        for (const mode of ["self", "friend"] as const) {
          expect(known).toContain(p.writer.buildSystem(level, mode));
        }
      }
    }
  });
});

describe("реестр пакетов", () => {
  it("неизвестное имя: явная ошибка", () => {
    expect(() => getTastePack("taste/nope")).toThrow(UnknownTastePackError);
  });

  it("повторная регистрация и снятие встроенного запрещены", () => {
    expect(() => registerTastePack({ ...getTastePack(), name: "taste/v1" })).toThrow();
    expect(() => unregisterTastePack("taste/v1")).toThrow();
  });
});

describe("шаг write берёт пакет по имени", () => {
  const testPack = (): TastePack => {
    const base = getTastePack("taste/v1");
    return {
      ...base,
      name: "taste/test-x",
      writer: {
        ...base.writer,
        version: "roast/test-x",
        buildPrompt: (input) => {
          const p = base.writer.buildPrompt(input);
          return { ...p, system: `${p.system}\nПАКЕТ-ТЕСТ-X` };
        },
      },
    };
  };
  beforeEach(() => registerTastePack(testPack()));
  afterEach(() => unregisterTastePack("taste/test-x"));

  it("промпт и трасса идут из выбранного пакета, правка кода шага не нужна", async () => {
    const writer = fakeWriter();
    const r = await writeCandidates(
      inputBase({ tier: 1, tastePack: "taste/test-x" }),
      makeWriteDeps({ writer, judge: fakeJudge(), moderator: fakeModerator() }),
    );
    expect(writer.mock.calls[0]![0].system).toContain("ПАКЕТ-ТЕСТ-X");
    expect(r.tastePack).toBe("taste/test-x");
    expect(r.promptVersion).toBe("roast/test-x");
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.trace.tastePack).toBe("taste/test-x");
      expect(PunchTraceSchema.parse(c.trace).tastePack).toBe("taste/test-x");
    }
    expect(WriteTrace.parse(r.trace).tastePack).toBe("taste/test-x");
  });

  it("без имени берётся текущий пакет и он пишется в каждую шутку", async () => {
    const writer = fakeWriter();
    const r = await writeCandidates(inputBase({ tier: 1 }), makeWriteDeps({ writer }));
    expect(writer.mock.calls[0]![0].system).not.toContain("ПАКЕТ-ТЕСТ-X");
    for (const c of r.candidates) expect(c.trace.tastePack).toBe("taste/v1");
  });
});

describe("неизвестный пакет", () => {
  it("ошибка до любого вызова LLM и до банка", async () => {
    const deps = makeWriteDeps({
      writer: fakeWriter(),
      judge: fakeJudge(),
      moderator: fakeModerator(),
    });
    const loadBank = vi.fn(deps.loadBank);
    const run = () =>
      writeCandidates(inputBase({ tastePack: "taste/nope" }), { ...deps, loadBank });
    await expect(run()).rejects.toThrow(UnknownTastePackError);
    await expect(run()).rejects.not.toBeInstanceOf(WriteFailedError);
    expect(deps.writer).not.toHaveBeenCalled();
    expect(deps.judge).not.toHaveBeenCalled();
    expect(deps.moderator).not.toHaveBeenCalled();
    expect(loadBank).not.toHaveBeenCalled();
  });
});

describe("старые трассы без пакета", () => {
  it("перенос из Поджога до H1: трасса читается, пакет помечен pre-taste", () => {
    const t = PunchTraceSchema.parse({
      hookId: "o1",
      mechanism: "hyperbole",
      evidenceRef: "post:0",
      jokeCardId: null,
      scores: null,
      totalScore: null,
      promptVersion: "roast/v2",
      writerModel: "w",
      judgeModel: "j",
    });
    expect(t.tastePack).toBe("pre-taste");
  });
});
