// Парсер корпуса шуток (roast-engine.md §5.1). Чистая функция: без IO, без БД.
// Корпус позже уедет из репозитория (§13 п.2), поэтому код знает только формат, не путь.

export type ParsedJoke = {
  /** `s<раздел>#<номер>`; у формул без номера — порядковый в разделе. */
  source: string;
  section: number;
  sectionTitle: string;
  /** Номер из md; у маркированных формул раздела 15 его нет. */
  number?: number;
  text: string;
  /** Пометка 🔞 у строки или в заголовке раздела. */
  nsfw: boolean;
};

export type ParseResult = {
  records: ParsedJoke[];
  /** Проблемы корпуса (дубль source, пустой текст): запись пропущена, номер строки + причина. */
  issues: string[];
};

const NSFW_MARK = /🔞️?/gu;
const SECTION_RE = /^##\s+(\d+)\.\s*(.*)$/u;
const NUMBERED_RE = /^(\d+)\.\s+(.*)$/u;
const FORMULA_RE = /^-\s+\*\*[^*]*\*\*\s*(.*)$/u;
// Конец корпуса: разделитель и «Замечания» в хвосте файла не шутки.
const END_RE = /^(---+|Замечания\b.*)$/u;

function clean(raw: string): { text: string; nsfw: boolean } {
  const nsfw = new RegExp(NSFW_MARK.source, "u").test(raw);
  let text = raw.replace(NSFW_MARK, "").trim();
  // У формул текст обёрнут в «…»: снимаем внешнюю пару, внутренние кавычки остаются.
  if (text.startsWith("«") && text.endsWith("»")) text = text.slice(1, -1).trim();
  return { text, nsfw };
}

export function parseJokesMd(md: string): ParseResult {
  const records: ParsedJoke[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();

  type Pending = {
    section: number;
    sectionTitle: string;
    number?: number;
    raw: string;
    line: number;
  };
  let section: { number: number; title: string; nsfw: boolean; ordinal: number } | null = null;
  let pending: Pending | null = null;

  const flush = () => {
    if (!pending || !section) return;
    const { text, nsfw } = clean(pending.raw);
    const num = pending.number ?? section.ordinal;
    const source = `s${pending.section}#${num}`;
    if (!text) issues.push(`строка ${pending.line}: пустой текст (${source})`);
    else if (seen.has(source)) issues.push(`строка ${pending.line}: повтор source ${source}`);
    else {
      seen.add(source);
      records.push({
        source,
        section: pending.section,
        sectionTitle: pending.sectionTitle,
        ...(pending.number !== undefined ? { number: pending.number } : {}),
        text,
        nsfw: nsfw || section.nsfw,
      });
    }
    pending = null;
  };

  const lines = md.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const head = SECTION_RE.exec(line);
    if (head) {
      flush();
      const title = head[2] ?? "";
      section = {
        number: Number(head[1]),
        title: title.replace(NSFW_MARK, "").trim(),
        nsfw: new RegExp(NSFW_MARK.source, "u").test(title),
        ordinal: 0,
      };
      return;
    }
    // Шапка до первого `## ` игнорируется.
    if (!section) return;
    if (END_RE.test(line)) {
      flush();
      section = null;
      return;
    }
    const numbered = NUMBERED_RE.exec(line);
    const formula = numbered ? null : FORMULA_RE.exec(line);
    if (numbered || formula) {
      flush();
      section.ordinal += 1;
      pending = {
        section: section.number,
        sectionTitle: section.title,
        ...(numbered ? { number: Number(numbered[1]) } : {}),
        raw: (numbered ? numbered[2] : formula?.[1]) ?? "",
        line: lineNo,
      };
      return;
    }
    // Продолжение многострочной шутки или диалога (`— …`): клеим к предыдущей записи.
    if (pending && line.trim()) pending.raw += `\n${line.trim()}`;
    else if (!line.trim()) flush();
  });
  flush();

  return { records, issues };
}
