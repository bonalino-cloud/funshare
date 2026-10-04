import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import type { ReviewCard } from "./repository";
import { exportReviewCsv, planReviewImport, REVIEW_COLUMNS } from "./review";
import { textHash } from "./text";

const card = (source: string, over: Partial<ReviewCard> = {}): ReviewCard => {
  const text = over.text ?? `Текст, с запятой и "кавычками" ${source}`;
  return {
    source,
    text,
    textHash: textHash(text, false),
    approved: false,
    mechanism: "reversal",
    skeleton: "{Действие}, чтобы {функция}",
    slots: ["habit"],
    heat: "mild",
    topic: "behavior",
    redline: false,
    wellDoneOnly: false,
    nsfw: false,
    transferable: true,
    ...over,
  };
};

const cards = [
  card("s2#1"),
  card("s1#10", { text: "Строка\nс переносом" }),
  card("s1#2", { approved: true }),
  card("s1#3", { topic: "health", redline: true }),
];

describe("exportReviewCsv", () => {
  it("колонки по ТЗ, порядок по разделу и номеру, переносы и кавычки сохраняются", () => {
    const rows = parseCsv(exportReviewCsv(cards));
    expect(rows[0]).toEqual([...REVIEW_COLUMNS]);
    expect(rows.slice(1).map((r) => r[0])).toEqual(["s1#2", "s1#3", "s1#10", "s2#1"]);
    expect(rows[3]![1]).toBe("Строка\nс переносом");
    expect(rows[1]![1]).toContain('"кавычками"');
  });

  it("--pending: только неодобренные", () => {
    const rows = parseCsv(exportReviewCsv(cards, { pendingOnly: true }));
    expect(rows.slice(1).map((r) => r[0])).not.toContain("s1#2");
  });

  it("ячейка, начинающаяся с =, экспортируется с апострофом", () => {
    const rows = parseCsv(exportReviewCsv([card("s1#1", { skeleton: "=HYPERLINK(x)" })]));
    expect(rows[1]![3]).toBe("'=HYPERLINK(x)");
  });
});

function edit(
  csv: string,
  source: string,
  patch: Partial<Record<(typeof REVIEW_COLUMNS)[number], string>>,
) {
  const rows = parseCsv(csv);
  const header = rows[0]!;
  for (const row of rows.slice(1)) {
    if (row[0] !== source) continue;
    for (const [k, v] of Object.entries(patch)) row[header.indexOf(k)] = v;
  }
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

describe("planReviewImport", () => {
  const csv = exportReviewCsv(cards);

  it("approved применяется, без изменений — не трогаем", () => {
    const plan = planReviewImport(edit(csv, "s1#10", { approved: "true" }), cards);
    expect(plan.updates).toEqual([{ source: "s1#10", approved: true }]);
    expect(plan.unchanged).toBe(3);
    expect(plan.rejected).toEqual([]);
  });

  it("снять одобрение можно; пустая ячейка = не трогать", () => {
    const plan = planReviewImport(
      edit(edit(csv, "s1#2", { approved: "нет" }), "s2#1", { approved: "" }),
      cards,
    );
    expect(plan.updates).toEqual([{ source: "s1#2", approved: false }]);
  });

  it("redline/wellDoneOnly/nsfw из CSV игнорируются: красную линию снять нельзя", () => {
    const plan = planReviewImport(
      edit(csv, "s1#3", { redline: "false", nsfw: "true", approved: "true" }),
      cards,
    );
    expect(plan.updates).toEqual([{ source: "s1#3", approved: true }]);
  });

  it("ручная правка темы идёт через deriveFlags: body → wellDoneOnly, health остаётся redline", () => {
    const toBody = planReviewImport(edit(csv, "s1#10", { topic: "body" }), cards);
    expect(toBody.updates[0]?.label).toMatchObject({
      topic: "body",
      wellDoneOnly: true,
      redline: false,
    });
    const toBehavior = planReviewImport(edit(csv, "s1#3", { topic: "behavior" }), cards);
    // флаг остаётся (только ужесточение): снять красную линию правкой темы нельзя
    expect(toBehavior.updates[0]?.label).toMatchObject({ topic: "behavior", redline: true });
  });

  it("правка skeleton/mechanism/heat принимается, апостроф защиты снимается", () => {
    const plan = planReviewImport(
      edit(csv, "s1#10", { skeleton: "'=новый скелет", mechanism: "hyperbole", heat: "hard" }),
      cards,
    );
    expect(plan.updates[0]?.label).toMatchObject({
      skeleton: "=новый скелет",
      mechanism: "hyperbole",
      heat: "hard",
    });
  });

  it("битые значения отклоняются со ссылкой на source, остальные применяются", () => {
    const bad = edit(edit(csv, "s1#10", { approved: "наверное" }), "s2#1", { heat: "scorching" });
    const plan = planReviewImport(edit(bad, "s1#2", { approved: "0" }), cards);
    expect(plan.updates).toEqual([{ source: "s1#2", approved: false }]);
    expect(plan.rejected).toEqual([
      { source: "s1#10", reason: "некорректно: approved" },
      { source: "s2#1", reason: "некорректно: heat" },
    ]);
  });

  it("многострочный skeleton отклоняется схемой", () => {
    const plan = planReviewImport(edit(csv, "s1#10", { skeleton: "a\nb" }), cards);
    expect(plan.rejected).toEqual([{ source: "s1#10", reason: "некорректно: skeleton" }]);
  });

  it("устаревший text, неизвестный source и повтор строки отклоняются", () => {
    const stale = planReviewImport(
      edit(csv, "s1#10", { text: "Другой текст", approved: "true" }),
      cards,
    );
    expect(stale.rejected).toEqual([{ source: "s1#10", reason: "текст изменился с экспорта" }]);

    const unknown = planReviewImport(`source,text,approved\ns9#9,x,true\n`, cards);
    expect(unknown.rejected).toEqual([{ source: "s9#9", reason: "нет такой карточки" }]);

    const one = card("s1#2");
    const dup = planReviewImport(
      `source,text,approved\r\ns1#2,"${one.text.replace(/"/g, '""')}",true\r\ns1#2,"${one.text.replace(/"/g, '""')}",false\r\n`,
      [one],
    );
    expect(dup.updates).toEqual([{ source: "s1#2", approved: true }]);
    expect(dup.rejected).toEqual([{ source: "s1#2", reason: "повтор строки" }]);
  });

  it("CSV без обязательных колонок — ошибка", () => {
    expect(() => planReviewImport("a,b\n1,2\n", cards)).toThrow("source");
    expect(() => planReviewImport("", cards)).toThrow();
  });

  it("Excel-вариант: разделитель ; и BOM", () => {
    const text = cards[1]!.text.replace(/"/g, '""');
    const plan = planReviewImport(`﻿source;text;approved\r\ns1#10;"${text}";да\r\n`, cards);
    expect(plan.updates).toEqual([{ source: "s1#10", approved: true }]);
  });
});
