import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { publishSql } from "./artifact-repository";
import { submitSelectionSql } from "./repository";

const dialect = new PgDialect();
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const now = new Date("2026-10-05T12:00:00.000Z");

describe("submitSelectionSql", () => {
  const q = dialect.sqlToQuery(
    submitSelectionSql({ generationId: "g1", punchIds: ["a", "b", "c"], max: 6, now }),
  );
  const text = flat(q.sql);

  it("одна команда: замок на строке генерации по статусу и finishedAt IS NULL", () => {
    expect(text).toContain("UPDATE generations");
    expect(text).toContain("'awaiting_selection'");
    expect(text).toContain("finishedAt");
    expect(text).toContain("UPDATE punch_candidates");
    expect(text).toContain("selection_position");
  });

  it("id и порядок идут параметрами, не текстом SQL", () => {
    for (const id of ["a", "b", "c", "g1"]) expect(q.params).toContain(id);
    expect(text).not.toContain("'a'");
  });
});

describe("publishSql", () => {
  const q = dialect.sqlToQuery(
    publishSql({
      generationId: "g1",
      slug: "AbCdEfGh12",
      kind: "roast_v1",
      content: {
        title: "t",
        tagline: "t",
        punches: [{ id: "p", emoji: "🔥", text: "x" }],
        finale: "f",
        shareText: "s",
      },
      images: [],
      ownerTokenHash: "h",
      now,
    }),
  );
  const text = flat(q.sql);

  it("артефакт и ready одной командой, только из awaiting_selection/drawing, без дублей", () => {
    expect(text).toContain("INSERT INTO artifacts");
    expect(text).toContain("ON CONFLICT (generation_id) DO NOTHING");
    expect(text).toContain("'awaiting_selection', 'drawing'");
    expect(text).toContain("status = 'ready'");
    expect(text).toContain("EXISTS (SELECT 1 FROM art)");
    expect(text).toContain("FOR UPDATE");
  });

  it("содержимое идёт параметрами", () => {
    expect(q.params).toContain("AbCdEfGh12");
    expect(text).not.toContain("AbCdEfGh12");
  });
});
