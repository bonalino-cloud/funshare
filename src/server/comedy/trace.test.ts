import { describe, expect, it } from "vitest";
import { PunchTraceSchema } from "../roast/write/schema";
import { MAX_TRACE_CANDIDATES, ComedyTraceRecorder, newComedyEntry } from "./trace";
import { COMEDY_PROMPTS } from "./engine";

const oldTrace = {
  hookId: "o1",
  mechanism: "hyperbole",
  evidenceRef: "post:0",
  jokeCardId: null,
  scores: null,
  totalScore: null,
  tastePack: "taste/v1",
  promptVersion: "roast/v2",
  writerModel: "w",
  judgeModel: "j",
};

describe("PunchTraceSchema: поля comedy необязательны", () => {
  it("старая запись без structure и insightId читается как раньше", () => {
    const t = PunchTraceSchema.parse(oldTrace);
    expect(t.structure).toBeUndefined();
    expect(t.insightId).toBeUndefined();
    expect(t.tastePack).toBe("taste/v1");
  });

  it("запись comedy со структурой и инсайтом; чужая структура не проходит", () => {
    const t = PunchTraceSchema.parse({
      ...oldTrace,
      mechanism: "meta",
      tastePack: "comedy/v1",
      structure: "quote_twist",
      insightId: "C2",
    });
    expect(t).toMatchObject({ structure: "quote_twist", insightId: "C2" });
    expect(PunchTraceSchema.safeParse({ ...oldTrace, structure: "pun" }).success).toBe(false);
  });
});

describe("ComedyTraceRecorder", () => {
  const recorder = () =>
    new ComedyTraceRecorder({
      level: "well_done",
      mode: "self",
      tier: 1,
      prompts: COMEDY_PROMPTS,
      models: {
        profile: "m",
        insights: "m",
        select: "m",
        punch: "m",
        editor: "m",
        moderator: "h",
      },
    });

  it("пустой запуск (провал до профиля) даёт валидную трассу", () => {
    const t = recorder().build({ result: "failed", failure: "llm_failed" });
    expect(t).toMatchObject({ result: "failed", failure: "llm_failed", profile: null });
    expect(t?.stats.written).toBe(0);
  });

  it("лишние записи отрезаются, длинный текст режется: трасса не падает", () => {
    const rec = recorder();
    for (let i = 0; i < MAX_TRACE_CANDIDATES + 5; i++) {
      rec.add(newComedyEntry({ round: 1, insightId: "A1", text: "я".repeat(1000) }));
    }
    const t = rec.build({ result: "ok" });
    expect(t?.candidates).toHaveLength(MAX_TRACE_CANDIDATES);
    expect(t?.omittedCandidates).toBe(5);
    expect(t?.candidates[0]?.text?.length).toBe(400);
  });

  it("собранное не по схеме: null, а не исключение", () => {
    const rec = recorder();
    rec.add({ ...newComedyEntry({ round: 1, insightId: "A1" }), round: 99 });
    expect(rec.build({ result: "ok" })).toBeNull();
  });
});
