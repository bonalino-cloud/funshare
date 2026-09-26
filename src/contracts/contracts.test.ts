import { describe, expect, it } from "vitest";
import { Artifact, GenerationStatus } from "./index";
import artifactDossier from "./fixtures/artifact-dossier.json";
import statusFailed from "./fixtures/status-failed.json";
import statusSequence from "./fixtures/status-sequence.json";

describe("фикстуры проходят схемы", () => {
  it("status-sequence.json", () => {
    const parsed = statusSequence.map((s) => GenerationStatus.parse(s));
    expect(parsed.map((s) => s.status)).toEqual([
      "queued",
      "scraping",
      "analyzing",
      "writing",
      "drawing",
      "ready",
    ]);
  });

  it("status-failed.json", () => {
    expect(GenerationStatus.parse(statusFailed).status).toBe("failed");
  });

  it("artifact-dossier.json", () => {
    const artifact = Artifact.parse(artifactDossier);
    const ready = statusSequence.at(-1);
    expect(artifact.slug).toBe(ready && "artifactSlug" in ready ? ready.artifactSlug : undefined);
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
