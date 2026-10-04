import { describe, expect, it } from "vitest";
import { guardCell, parseCsv, toCsv, unguardCell } from "./csv";

describe("csv", () => {
  const rows = [
    ["a", "b", "c"],
    ["запятая, внутри", 'кавычки "тут"', "перенос\nстроки\r\nи CRLF"],
    ["", "пусто слева", '""'],
  ];

  it("round-trip: кавычки, запятые и переносы внутри поля", () => {
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("BOM в начале, CRLF между строками", () => {
    const csv = toCsv([["x"], ["y"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿x\r\ny\r\n");
  });

  it("читает файл с BOM, LF и без финального перевода строки", () => {
    expect(parseCsv('﻿a,b\n1,"2\n3"')).toEqual([
      ["a", "b"],
      ["1", "2\n3"],
    ]);
  });

  it("разделитель ; (Excel с русской локалью) определяется по заголовку", () => {
    expect(parseCsv('a;b\n"x, y";"z;w"\n')).toEqual([
      ["a", "b"],
      ["x, y", "z;w"],
    ]);
  });

  it("файл не в UTF-8 (cp1251 из Excel) — понятная ошибка, а не «текст изменился» по всем строкам", () => {
    const cp1251 = new TextDecoder("utf-8").decode(new Uint8Array([0x73, 0x3b, 0xf2, 0xe5, 0xea]));
    expect(() => parseCsv(cp1251)).toThrow(/UTF-8/);
  });

  it("незакрытая кавычка — ошибка, а не молчаливый мусор", () => {
    expect(() => parseCsv('a,b\n"1,2')).toThrow();
  });

  it("защита от formula injection: апостроф туда и обратно", () => {
    for (const v of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      expect(guardCell(v)).toBe(`'${v}`);
      expect(unguardCell(guardCell(v))).toBe(v);
    }
    expect(guardCell("обычный")).toBe("обычный");
    expect(unguardCell("'обычный")).toBe("'обычный");
  });
});
