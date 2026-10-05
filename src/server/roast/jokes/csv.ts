// Минимальный CSV (RFC 4180) без зависимостей: кавычки, запятые и переносы внутри поля.

const BOM = "﻿";

/** Ошибка формата файла. Сообщение наше и без текстов шуток: скрипт печатает его целиком. */
export class CsvFormatError extends Error {
  override name = "CsvFormatError";
}

/**
 * Защита от formula injection: Excel исполняет ячейку, начинающуюся с = + - @. Скелет приходит
 * от модели по недоверенному тексту, поэтому такие ячейки экспортируем с ведущим апострофом.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function guardCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Обратное к `guardCell`: снимает апостроф только перед опасным символом. */
export function unguardCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** UTF-8 с BOM (Excel сам определяет кодировку), строки через CRLF. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return BOM + rows.map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
}

/**
 * Excel с русской локалью сохраняет CSV с `;`. Заголовок без кавычек, так что хватает первой строки.
 */
function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  return header.split(";").length > header.split(",").length ? ";" : ",";
}

export function parseCsv(input: string): string[][] {
  // Excel по умолчанию сохраняет «CSV» в cp1251: при чтении как UTF-8 кириллица превращается в �,
  // и все строки отклонились бы как «текст изменился». Говорим прямо, что не так с файлом.
  if (input.includes("�")) {
    throw new CsvFormatError(
      "CSV не в UTF-8: в Excel сохрани как «CSV UTF-8 (разделитель — запятая)»",
    );
  }
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) endField();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
    } else if (ch === "\n") endRow();
    else field += ch;
    i += 1;
  }
  if (inQuotes) throw new CsvFormatError("CSV: незакрытая кавычка");
  // Последняя строка без перевода строки.
  if (field !== "" || row.length > 0) endRow();
  // Пустые строки (в том числе хвостовые) пропускаем.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
