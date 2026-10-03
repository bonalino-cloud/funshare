// Текстовые примитивы для ProfileFacts: очистка недоверенного текста, вырезание PII, кэп.
// Подписи и био пишет посторонний человек: всё здесь — защита от мусора и утечек
// персональных данных, ДО любого подсчёта и ДО отправки в LLM.

/** Максимум символов (кодпоинтов) подписи, идущей в LLM (roast-engine.md §3). */
export const CAPTION_CAP = 300;
/** Максимум символов очищенного био. */
export const BIO_CAP = 500;
/** Подпись в Instagram — до 2200 символов, био — до 150; запас на юникод-двойники. */
const RAW_INPUT_LIMIT = 2_500;

/** Длина в кодпоинтах (а не в UTF-16 юнитах): эмодзи считается за 1. */
export function codepointLength(text: string): number {
  return Array.from(text).length;
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// Управляющие (в т.ч. \u0000, \n, \t), форматные (zero-width, bidi-override), private-use.
const CONTROL_LIKE = /[\p{Cc}\p{Co}]|(?!\u{200d})\p{Cf}/gu;

/**
 * Очистка недоверенного текста: NFKC (схлопывает полноширинные цифры и «＠»,
 * чтобы PII не пряталась за юникод-двойниками), без управляющих и форматных символов
 * (кроме ZWJ, он склеивает эмодзи), без одиночных суррогатов, пробелы схлопнуты.
 * Переводы строк и табы превращаются в пробел, а не склеивают слова.
 * Угловые скобки -> «‹›» (после NFKC, который сводит «＜» к «<»): подпись не может
 * закрыть тег `<profile_data>` в промпте analyze, даже если сборщик промпта забудет экранировать.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(LONE_SURROGATE, "")
    .normalize("NFKC")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/[\t\n\r\p{Zl}\p{Zp}\u0085]+/gu, " ")
    .replace(CONTROL_LIKE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Резать по кодпоинтам: суррогатная пара не разрывается; хвостовой ZWJ убирается. */
export function capCodepoints(text: string, cap: number): string {
  const points = Array.from(text);
  if (points.length <= cap) return text;
  return points
    .slice(0, cap)
    .join("")
    .replace(/\u{200d}+$/u, "")
    .trimEnd();
}

// ---------------------------------------------------------------------------
// PII. Эвристики, не гарантия: лучше потерять безобидную подпись, чем отправить
// телефон в LLM. Любая находка => подпись помечается hadPii и в LLM не идёт.
// ---------------------------------------------------------------------------

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

// Схема/www, либо «голый» домен с известной зоной (чтобы «конец.Начало» не резалось).
const TLDS =
  "com|ru|net|org|io|me|ua|by|kz|uz|kg|am|ge|info|co|cc|be|gl|ai|dev|pro|page|app|ly|gg|tv|fm|ee|shop|store|site|online|xyz|link|bio|uk|us|eu|de|fr|it|es|pl|su|рф";
const URL_LIKE = new RegExp(
  String.raw`(?:https?:\/\/|www\.)[^\s]+|(?<![\p{L}\p{N}@.])(?:[\p{L}\p{N}-]+\.)+(?:${TLDS})(?![\p{L}\p{N}])(?:[/?#][^\s]*)?`,
  "giu",
);

// 13–19 цифр с пробелами/дефисами/тире (\p{Pd}). Без проверки Луна: консервативнее
// (любой длинный числовой ряд считаем карточным).
const CARD = /(?<![\p{N}])(?:\d[ \p{Pd}]?){12,18}\d(?![\p{N}])/gu;

// Телефон: ряд из цифр и разделителей (включая типографские тире); решает счётчик цифр:
// от 10 (E.164 — до 15; больше 15 — обычно два номера подряд, тоже PII).
const PHONE_CANDIDATE = /(?<![\p{N}])\+?\d[\d ().\p{Pd}]{7,}\d(?![\p{N}])/gu;

const STREET_WORD = "street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr";
const ADDRESS_PATTERNS: RegExp[] = [
  // ул. Ленина, 5 / улица Пушкина 10 / проспект Мира 7 / пр-т Мира
  /(?<![\p{L}])(?:[Уу]л\.|[Уу]лица|[Уу]лице|[Пп]р\.|[Пп]р-т|[Пп]росп\.|[Пп]роспект|[Пп]ер\.|[Пп]ереулок|[Бб]ул\.|[Бб]ульвар|[Бб]-р|[Нн]аб\.|[Нн]абережная|[Шш]оссе)\s*[\p{Lu}\d][\p{L}\d-]*(?:[ ,]+(?:д\.?\s*)?\d+[\p{L}]?(?:\/\d+)?)?/gu,
  // д. 5, кв. 12
  /(?<![\p{L}])(?:д|кв)\.\s*\d+/gu,
  // 221 Baker Street, 5 Main St.
  new RegExp(
    String.raw`(?<![\p{N}])\d{1,5}\s+(?:[\p{L}'.-]+\s+){1,3}?(?:${STREET_WORD})\b\.?`,
    "giu",
  ),
  // Main Street 5 (название с заглавной, номер после)
  new RegExp(String.raw`\p{Lu}[\p{L}'-]+\s+(?:${STREET_WORD})\b\.?,?\s*\d+`, "gu"),
];

export type PiiScrubResult = { text: string; hadPii: boolean };

function countDigits(s: string): number {
  return s.replace(/\D/g, "").length;
}

/**
 * Вырезает PII из уже очищенного (`sanitizeText`) текста; фрагменты заменяются пробелом
 * ДО любого подсчёта. Порядок важен: email -> ссылки -> карта -> телефон -> адрес.
 * Не ловим: «at/dot»-обфускацию, короткие городские номера без кода (<10 цифр),
 * цифры не из ASCII (после NFKC остаются только арабо-индийские и т.п.).
 */
export function scrubPii(text: string): PiiScrubResult {
  let hadPii = false;
  const cut = (re: RegExp, src: string) =>
    src.replace(re, () => {
      hadPii = true;
      return " ";
    });

  let out = cut(EMAIL, text);
  out = cut(URL_LIKE, out);
  out = cut(CARD, out);
  out = out.replace(PHONE_CANDIDATE, (m) => {
    const digits = countDigits(m);
    if (digits < 10) return m;
    hadPii = true;
    return " ";
  });
  for (const re of ADDRESS_PATTERNS) out = cut(re, out);

  return { text: hadPii ? out.replace(/\s+/g, " ").trim() : out, hadPii };
}

/** sanitize -> scrub (кэп здесь НЕ применяется: сначала PII, чтобы кэп не оставил огрызок номера). */
export function cleanUntrusted(raw: string): PiiScrubResult {
  // Жёсткий потолок входа (подпись в Instagram до 2200): регэкспы ниже квадратичны на
  // патологических строках, а размер строки в ProfileSnapshot ничем не ограничен.
  // Режем и после sanitize: NFKC раздувает символ до 18 (U+FDFA), обходя первый срез.
  // Огрызок номера на срезе не утекает: срез далеко за кэпами подписи/био/локации.
  const sanitized = sanitizeText(raw.slice(0, RAW_INPUT_LIMIT));
  return scrubPii(capCodepoints(sanitized, RAW_INPUT_LIMIT));
}
