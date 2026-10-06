import { describe, expect, it } from "vitest";
import { bump, emptyReport, formatReport, mergeCounts, totalCount } from "./report";

describe("счётчики вычеркнутого", () => {
  it("bump, merge и сумма", () => {
    const a: Record<string, number> = {};
    bump(a, "profanity");
    bump(a, "profanity");
    bump(a, "hedging", 3);
    const b: Record<string, number> = { profanity: 1 };
    mergeCounts(b, a);
    expect(b).toEqual({ profanity: 3, hedging: 3 });
    expect(totalCount(b)).toBe(6);
  });
  it("лог: только коды и числа, в стабильном порядке", () => {
    const r = emptyReport();
    expect(formatReport(r)).toBe("l4=- l5=- модератор_проверил=0 проходов=0");
    bump(r.layer4, "profanity", 2);
    bump(r.layer4, "duplicate");
    bump(r.layer5, "unclear");
    r.moderatorChecked = 12;
    r.moderatorPasses = 1;
    expect(formatReport(r)).toBe(
      "l4=duplicate:1,profanity:2 l5=unclear:1 модератор_проверил=12 проходов=1",
    );
  });
  it("структура JSON-совместима: без потерь через JSON (для generation_traces)", () => {
    const r = emptyReport();
    bump(r.layer4, "topic_health");
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
