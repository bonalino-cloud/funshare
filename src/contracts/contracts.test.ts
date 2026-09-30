import { describe, expect, it } from "vitest";
import {
  Artifact,
  CandidatesResponse,
  GenerationRequest,
  GenerationStatus,
  Pricing,
  ProfileCheckStatus,
  Quote,
  SelectionRequest,
} from "./index";
import artifactDossier from "./fixtures/artifact-dossier.json";
import artifactRoast from "./fixtures/artifact-roast.json";
import candidates20 from "./fixtures/candidates-20.json";
import generationRequest from "./fixtures/generation-request.json";
import pricing from "./fixtures/pricing.json";
import profileCheckFailed from "./fixtures/profile-check-failed.json";
import profileCheckOk from "./fixtures/profile-check-ok.json";
import quotes from "./fixtures/quotes.json";
import selection from "./fixtures/selection.json";
import statusFailed from "./fixtures/status-failed.json";
import statusSequence from "./fixtures/status-sequence.json";

describe("фикстуры проходят схемы", () => {
  it("profile-check-ok.json: checking → ok с профилем", () => {
    const parsed = profileCheckOk.map((s) => ProfileCheckStatus.parse(s));
    expect(parsed.map((s) => s.status)).toEqual(["checking", "checking", "checking", "ok"]);
    expect(parsed.at(-1)?.profile?.username).toBe("anya.travels");
  });

  it("profile-check-failed.json: по одному на каждый errorCode проверки", () => {
    const codes = profileCheckFailed.map((s) => ProfileCheckStatus.parse(s).errorCode);
    expect(codes).toEqual([
      "invalid_url",
      "profile_not_found",
      "profile_private",
      "not_enough_data",
      "minor_detected",
      "rate_limited",
      "internal",
    ]);
  });

  it("pricing.json: три тарифа, Поджог без картинок, Пекло пока без видео", () => {
    const p = Pricing.parse(pricing);
    expect(p.tiers.map((t) => t.tier)).toEqual([1, 2, 3]);
    expect(p.tiers.map((t) => t.listAmount)).toEqual([9900, 19900, 29900]);
    expect(p.tiers[0]?.imageCount).toBe(0);
    expect(p.tiers[2]?.video).toBe(false);
  });

  it("quotes.json: все варианты сходятся по сумме", () => {
    const q = Object.values(quotes).map((x) => Quote.parse(x));
    expect(q.map((x) => x.finalAmount)).toEqual([19900, 0, 9950, 0]);
  });

  it("generation-request.json", () => {
    expect(GenerationRequest.parse(generationRequest).tier).toBe(2);
  });

  it("status-sequence.json: генерация начинается с текста, пауза на выбор шуток", () => {
    const parsed = statusSequence.map((s) => GenerationStatus.parse(s));
    expect(parsed.map((s) => s.status)).toEqual([
      "queued",
      "writing",
      "writing",
      "awaiting_selection",
      "drawing",
      "ready",
    ]);
  });

  it("status-failed.json", () => {
    expect(GenerationStatus.parse(statusFailed).status).toBe("failed");
  });

  it("candidates-20.json: 20 кандидатов Кострища, выбрать 6", () => {
    const c = CandidatesResponse.parse(candidates20);
    expect(c.candidates).toHaveLength(20);
    expect(c.selectCount).toBe(6);
  });

  it("selection.json: ровно selectCount id, все из кандидатов", () => {
    const s = SelectionRequest.parse(selection);
    const ids = new Set(candidates20.candidates.map((p) => p.id));
    expect(s.punchIds).toHaveLength(candidates20.selectCount);
    expect(s.punchIds.every((id) => ids.has(id))).toBe(true);
  });

  it("artifact-roast.json: в артефакте ровно выбранные шутки в порядке выбора", () => {
    const artifact = Artifact.parse(artifactRoast);
    expect(artifact.kind).toBe("roast_v1");
    if (artifact.kind !== "roast_v1") throw new Error("kind");
    expect(artifact.content.punches.map((p) => p.id)).toEqual(selection.punchIds);
    const ready = statusSequence.at(-1);
    expect(artifact.slug).toBe(ready && "artifactSlug" in ready ? ready.artifactSlug : undefined);
  });

  it("artifact-dossier.json: старый тип артефакта по-прежнему проходит", () => {
    expect(Artifact.parse(artifactDossier).kind).toBe("dossier_2027");
  });
});

describe("GenerationRequest", () => {
  const base = { profileCheckId: "chk", mode: "self", kind: "roast_v1", tier: 2 } as const;

  it("well_done без ageConfirmed — ошибка", () => {
    expect(() => GenerationRequest.parse({ ...base, level: "well_done" })).toThrow();
    expect(() =>
      GenerationRequest.parse({ ...base, level: "well_done", ageConfirmed: false }),
    ).toThrow();
    expect(GenerationRequest.parse({ ...base, level: "well_done", ageConfirmed: true }).level).toBe(
      "well_done",
    );
  });

  it("факт длиннее 140 знаков или больше 5 фактов — ошибка", () => {
    expect(() =>
      GenerationRequest.parse({ ...base, level: "medium", extraFacts: ["x".repeat(141)] }),
    ).toThrow();
    expect(() =>
      GenerationRequest.parse({ ...base, level: "medium", extraFacts: Array(6).fill("факт") }),
    ).toThrow();
  });
});

describe("GenerationStatus", () => {
  const base = { id: "g", updatedAt: "2026-09-26T12:00:00.000Z" };

  it("failed без errorCode — ошибка", () => {
    expect(() => GenerationStatus.parse({ ...base, status: "failed" })).toThrow();
  });

  it("errorCode при не-failed — ошибка", () => {
    expect(() =>
      GenerationStatus.parse({ ...base, status: "writing", errorCode: "internal" }),
    ).toThrow();
  });

  it("ready без artifactSlug — ошибка", () => {
    expect(() => GenerationStatus.parse({ ...base, status: "ready" })).toThrow();
  });
});

describe("ProfileCheckStatus", () => {
  const base = { id: "c", updatedAt: "2026-09-26T12:00:00.000Z" };

  it("ok без profile — ошибка", () => {
    expect(() => ProfileCheckStatus.parse({ ...base, status: "ok" })).toThrow();
  });

  it("profile при checking — ошибка", () => {
    expect(() =>
      ProfileCheckStatus.parse({
        ...base,
        status: "checking",
        profile: { username: "a", displayName: "A", avatarUrl: null, postsCount: 1 },
      }),
    ).toThrow();
  });
});

describe("Quote и Selection", () => {
  it("сумма не сходится — ошибка", () => {
    expect(() =>
      Quote.parse({
        tier: 2,
        listAmount: 19900,
        discountAmount: 100,
        finalAmount: 19900,
        currency: "RUB",
      }),
    ).toThrow();
  });

  it("повторы в punchIds — ошибка", () => {
    expect(() => SelectionRequest.parse({ punchIds: ["p1", "p1"] })).toThrow();
  });
});
