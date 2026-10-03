import type { Artifact } from "@/contracts";
import {
  CARD_H,
  CARD_W,
  IMAGE,
  LABEL,
  NICK,
  PAD_X,
  SEAM_H,
  labelY,
  layoutPunch,
  noImageBg,
  type Measure,
  type PunchLayout,
} from "@/components/artifact/card-layout";
import { alumni, unbounded } from "@/styles/fonts";

/** Всё, что нужно одной карточке. Собирается из артефакта, без сети. */
export type RoastCardData = {
  punchId: string;
  username: string;
  text: string;
  image: { url: string; alt: string } | null;
  bg: string;
};

export const PUNCH_FAMILY = alumni.style.fontFamily;
export const NICK_FAMILY = unbounded.style.fontFamily;

const punchFont = (size: number) => `700 ${size}px ${PUNCH_FAMILY}`;
const nickFont = (size: number) => `700 ${size}px ${NICK_FAMILY}`;

/** Карточки в порядке выбора шуток. Шутка без картинки (Поджог, упавшая клетка) — без картинки. */
export function roastCards(artifact: Artifact): RoastCardData[] {
  if (artifact.kind !== "roast_v1") return [];
  const images = new Map(artifact.punchImages.map((i) => [i.punchId, i]));
  return artifact.content.punches.map((p, i) => {
    const img = images.get(p.id);
    return {
      punchId: p.id,
      username: artifact.subject.username,
      text: p.text,
      image: img ? { url: img.url, alt: img.alt } : null,
      bg: img?.bg ?? noImageBg(i),
    };
  });
}

let ctx: CanvasRenderingContext2D | null = null;

/** Ширина строки шрифтом шутки. Шрифт должен быть загружен: см. `cardFontsReady`. */
export const measurePunch: Measure = (text, size) => {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * size * 0.39;
  ctx.font = punchFont(size);
  return ctx.measureText(text).width;
};

let fontsReady: Promise<void> | null = null;

/** Ждём шрифты карточки: без них canvas меряет и рисует запасным шрифтом. Не дольше 3 с. */
export function cardFontsReady(): Promise<void> {
  fontsReady ??= Promise.race([
    Promise.all([
      document.fonts.load(punchFont(100), "АБВ"),
      document.fonts.load(nickFont(28), "ABC"),
    ]).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, 3000)),
  ]).catch(() => undefined);
  return fontsReady;
}

export function cardLayout(card: RoastCardData): PunchLayout {
  return layoutPunch(card.text, measurePunch, card.image !== null);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Blob отдаёт картинки с CORS: без anonymous canvas станет «грязным» и не выгрузится в PNG
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${url}`));
    img.src = url;
  });
}

/** Базовая линия строки так же, как в CSS: полу-интерлиньяж сверху, потом ascent. */
function baselineIn(
  c: CanvasRenderingContext2D,
  font: string,
  lineTop: number,
  lineBox: number,
): number {
  c.font = font;
  const m = c.measureText("ЙЁ");
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;
  return lineTop + (lineBox - (asc + desc)) / 2 + asc;
}

/** Карточка в PNG 1080×1920: те же строки и координаты, что в `RoastCard`. */
export async function renderCardPng(card: RoastCardData): Promise<Blob> {
  await cardFontsReady();
  const layout = cardLayout(card);
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("canvas 2d");

  c.fillStyle = card.bg;
  c.fillRect(0, 0, CARD_W, CARD_H);

  if (card.image) {
    const img = await loadImage(card.image.url);
    c.drawImage(img, 0, IMAGE.top, IMAGE.size, IMAGE.size);
    const seam = c.createLinearGradient(0, IMAGE.top, 0, IMAGE.top + SEAM_H);
    seam.addColorStop(0, card.bg);
    seam.addColorStop(1, `${card.bg}00`);
    c.fillStyle = seam;
    c.fillRect(0, IMAGE.top, CARD_W, SEAM_H);
  }

  c.fillStyle = "#000";
  c.textBaseline = "alphabetic";
  c.textAlign = "left";

  const nickBox = NICK.size * 1.24;
  c.fillText(
    card.username.toLocaleUpperCase("ru-RU"),
    PAD_X,
    baselineIn(c, nickFont(NICK.size), NICK.top, nickBox),
  );

  const lineBox = layout.fontSize * layout.lineHeight;
  layout.lines.forEach((line, i) => {
    const y = baselineIn(c, punchFont(layout.fontSize), layout.top + i * lineBox, lineBox);
    c.fillText(line, PAD_X, y);
  });

  c.fillStyle = "#fff";
  c.beginPath();
  const ly = labelY(card.image !== null);
  c.roundRect(LABEL.x, ly, LABEL.w, LABEL.h, LABEL.radius);
  c.fill();
  c.save();
  c.translate(LABEL.x + LABEL.w / 2, ly + LABEL.h / 2);
  c.rotate(-Math.PI / 2);
  c.fillStyle = "#000";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = nickFont(LABEL.size);
  c.fillText(LABEL.text, 0, 0);
  c.restore();

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"),
  );
}
