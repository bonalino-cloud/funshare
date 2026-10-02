/**
 * Геометрия карточки артефакта 9:16 в координатах макета Figma (FUNSHARE → Card Short /
 * Card Medium / Card 03 Long), 1 единица = 1 px картинки 1080×1920. Одна раскладка на
 * страницу и на PNG: и вёрстка, и canvas берут строки шутки отсюда, поэтому скачанная
 * карточка совпадает с тем, что человек видел на экране.
 */

export const CARD_W = 1080;
export const CARD_H = 1920;

/** Поля и колонка текста. В макете текст 905 при поле 80: справа 95. */
export const PAD_X = 80;
export const TEXT_W = 905;

/** Ник: Unbounded Bold 28, верх строки на 100. */
export const NICK = { top: 100, size: 28 } as const;

/** Ниже ника шутка не поднимается. */
const TEXT_TOP_LIMIT = 200;

/** Квадрат картинки во всю ширину, прижат к низу. */
export const IMAGE = { size: CARD_W, top: CARD_H - CARD_W } as const;

/** Шов между фоном карточки и квадратом прячем градиентом цвета фона сверху вниз. */
export const SEAM_H = 180;

/** Нижняя линия шутки над картинкой: в макете все три длины кончаются на 848. */
const TEXT_BOTTOM_WITH_IMAGE = 848;

/** Вертикальный ярлык FUNSHARE.RU: подложка 72×291 со скруглением 11,4, белый 90 %. */
export const LABEL = {
  x: PAD_X,
  y: 1235,
  w: 72,
  h: 291.4,
  radius: 11.4,
  size: 27.4,
  text: "FUNSHARE.RU",
} as const;

/** Без картинки ярлык уходит к нижнему краю, с тем же полем 80, что сбоку. */
export const LABEL_Y_NO_IMAGE = CARD_H - PAD_X - LABEL.h;

/** Верх ярлыка: с картинкой по макету, без неё у нижнего края. */
export const labelY = (hasImage: boolean) => (hasImage ? LABEL.y : LABEL_Y_NO_IMAGE);

/**
 * Кегль шутки. В макете DIN Condensed 96 / 1.02; у Alumni Sans глаз прописных ниже, поэтому
 * 104 и межстрочное 0.86 дают ту же высоту букв и тот же шаг строк, что в макете.
 */
export const PUNCH_FONT = {
  max: 104,
  maxNoImage: 132,
  min: 60,
  step: 2,
  lineHeight: 0.86,
} as const;

/** Фон карточки без картинки (Поджог). Палитра холста из Figma, без серого. */
export const NO_IMAGE_BG = [
  "#fff7b5",
  "#f8ccd9",
  "#d0f0ff",
  "#d1f7c4",
  "#fae5d0",
  "#cdfde6",
  "#f7d0f2",
  "#c1cffb",
  "#d7d0fa",
  "#e6febf",
] as const;

export type PunchLayout = {
  fontSize: number;
  lineHeight: number;
  lines: string[];
  /** Верх первой строки, единицы макета. */
  top: number;
};

/** Ширина строки при заданном кегле; на клиенте canvas.measureText, в тестах заглушка. */
export type Measure = (text: string, fontSize: number) => number;

/** Жадный перенос по словам. Слово шире колонки остаётся одно на строке: его ловит `fits`. */
export function wrap(text: string, fontSize: number, measure: Measure, width = TEXT_W): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, fontSize) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Подбирает кегль: самый крупный, при котором шутка влезает в колонку по ширине и в поле
 * между ником и картинкой по высоте. С картинкой текст прижат к её верху (как в макете),
 * без картинки стоит по центру карточки.
 */
export function layoutPunch(text: string, measure: Measure, hasImage: boolean): PunchLayout {
  const caps = text.toLocaleUpperCase("ru-RU");
  const bottom = TEXT_BOTTOM_WITH_IMAGE;
  // Без картинки текст по центру: по высоте не дальше, чем на 60 до ярлыка снизу
  const room = hasImage ? bottom - TEXT_TOP_LIMIT : 2 * (LABEL_Y_NO_IMAGE - 60 - CARD_H / 2);
  const max = hasImage ? PUNCH_FONT.max : PUNCH_FONT.maxNoImage;

  const fits = (ls: string[], size: number) =>
    ls.length * size * PUNCH_FONT.lineHeight <= room && ls.every((l) => measure(l, size) <= TEXT_W);

  let fontSize: number = max;
  let lines = wrap(caps, fontSize, measure);
  while (fontSize > PUNCH_FONT.min && !fits(lines, fontSize)) {
    fontSize = Math.max(PUNCH_FONT.min, fontSize - PUNCH_FONT.step);
    lines = wrap(caps, fontSize, measure);
  }

  const height = lines.length * fontSize * PUNCH_FONT.lineHeight;
  const top = hasImage ? bottom - height : (CARD_H - height) / 2;
  return { fontSize, lineHeight: PUNCH_FONT.lineHeight, lines, top };
}

/** Фон карточки без картинки: по номеру карточки, соседние не повторяются. */
export function noImageBg(index: number): string {
  return NO_IMAGE_BG[index % NO_IMAGE_BG.length] ?? NO_IMAGE_BG[0];
}
