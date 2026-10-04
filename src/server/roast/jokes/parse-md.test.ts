import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJokesMd } from "./parse-md";

const FIXTURE = `# Шапка

1. Это нумерованная строка из шапки, её нет в корпусе.

---

## 1. Первый раздел

1. Первая шутка про кота.
2. Вторая шутка про лампу. 🔞
5. Пятая: «в кавычках» остаётся.

## 2. Второй раздел 🔞

6. Тут нет своей пометки.
7. Диалог:
— Привет.
— Пока.

## 15. Шаблоны

- **«Один»:** «Первая формула с [пропуском].»
- **«Два»:** «Вторая формула «внутри» кавычек.» 🔞
- **«Один»:** «Третья формула.»

---

Замечания:
- 99. Не шутка.
`;

describe("parseJokesMd: форматы", () => {
  const { records, issues } = parseJokesMd(FIXTURE);
  const by = (source: string) => records.find((r) => r.source === source);

  it("шапка и хвост игнорируются, проблем нет", () => {
    expect(issues).toEqual([]);
    expect(records.map((r) => r.source)).toEqual([
      "s1#1",
      "s1#2",
      "s1#5",
      "s2#6",
      "s2#7",
      "s15#1",
      "s15#2",
      "s15#3",
    ]);
  });

  it("🔞 снимается с текста и ставит nsfw", () => {
    expect(by("s1#2")).toMatchObject({ text: "Вторая шутка про лампу.", nsfw: true });
    expect(by("s1#1")?.nsfw).toBe(false);
  });

  it("🔞 в заголовке раздела делает nsfw все его шутки", () => {
    expect(by("s2#6")?.nsfw).toBe(true);
    expect(by("s2#7")?.nsfw).toBe(true);
  });

  it("многострочная шутка склеивается через перенос", () => {
    expect(by("s2#7")?.text).toBe("Диалог:\n— Привет.\n— Пока.");
  });

  it("формулы: порядковый номер, внешние « » сняты, внутренние на месте", () => {
    expect(by("s15#1")).toMatchObject({ section: 15, text: "Первая формула с [пропуском]." });
    expect(by("s15#1")?.number).toBeUndefined();
    expect(by("s15#2")).toMatchObject({ text: "Вторая формула «внутри» кавычек.", nsfw: true });
  });

  it("повтор source и пустой текст — в issues, запись пропущена", () => {
    const r = parseJokesMd("## 1. Раздел\n\n1. Раз.\n1. Два.\n2. 🔞\n");
    expect(r.records).toHaveLength(1);
    expect(r.issues).toHaveLength(2);
  });

  it("CRLF и BOM не мешают", () => {
    const r = parseJokesMd("﻿## 1. Р\r\n\r\n1. Раз.\r\n2. Два.\r\n");
    expect(r.records.map((x) => x.text)).toEqual(["Раз.", "Два."]);
  });
});

// Корпус позже уедет из репозитория (roast-engine §13 п.2): без файла тест молча пропускается.
const REAL = "business/roast-jokes-depersonalized.md";
describe.skipIf(!existsSync(REAL))("parseJokesMd: реальный корпус", () => {
  const md = readFileSync(REAL, "utf8");
  const { records, issues } = parseJokesMd(md);

  // Независимый подсчёт по сырому тексту: от первого `## ` до хвоста `---`.
  const body = md.slice(md.indexOf("\n## ")).split(/\n---/)[0]!;
  const lines = body.split(/\r?\n/);
  const isItem = (l: string) => /^\d+\.\s/.test(l) || /^-\s+\*\*/.test(l);
  const items = lines.filter(isItem);

  it("число записей совпадает с числом строк-шуток, проблем нет", () => {
    expect(issues).toEqual([]);
    expect(records.length).toBe(items.length);
    expect(records.length).toBeGreaterThan(200);
  });

  it("нет пустых text, source уникальны и в формате", () => {
    expect(records.every((r) => r.text.trim().length > 0)).toBe(true);
    expect(new Set(records.map((r) => r.source)).size).toBe(records.length);
    expect(records.every((r) => /^s\d+#\d+$/.test(r.source))).toBe(true);
  });

  it("🔞 нигде не осталась в тексте; nsfw = строки с 🔞 + шутки разделов с 🔞 в заголовке", () => {
    expect(records.some((r) => r.text.includes("🔞"))).toBe(false);
    let nsfwSection = false;
    let expected = 0;
    for (const line of lines) {
      if (line.startsWith("## ")) nsfwSection = line.includes("🔞");
      else if (isItem(line) && (nsfwSection || line.includes("🔞"))) expected += 1;
    }
    expect(records.filter((r) => r.nsfw).length).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });
});
