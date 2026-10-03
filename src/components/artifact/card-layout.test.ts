import { describe, expect, it } from "vitest";
import {
  CARD_H,
  LABEL_Y_NO_IMAGE,
  PUNCH_FONT,
  TEXT_W,
  layoutPunch,
  noImageBg,
  wrap,
  type Measure,
} from "./card-layout";

/** Alumni Sans 700: строка из 31 прописного знака при 96 px шириной 1162 px. */
const alumni: Measure = (text, size) => text.length * size * 0.39;

const SHORT = "Бог создал его, чтобы у Ника тоже было кем вдохновляться.";
const LONG =
  "Твоё творчество так часто называют говном, что пора вернуть это название говну, а для твоего творчества придумать новое имя.";

describe("layoutPunch", () => {
  it("короткая шутка: максимальный кегль, низ строк на 848 над картинкой", () => {
    const l = layoutPunch(SHORT, alumni, true);
    expect(l.fontSize).toBe(PUNCH_FONT.max);
    expect(l.top + l.lines.length * l.fontSize * l.lineHeight).toBeCloseTo(848);
  });

  it("шутка на 140 знаков влезает между ником и картинкой", () => {
    const text = LONG.padEnd(140, " и").slice(0, 140);
    const l = layoutPunch(text, alumni, true);
    expect(l.top).toBeGreaterThanOrEqual(200);
    expect(l.lines.every((line) => alumni(line, l.fontSize) <= TEXT_W)).toBe(true);
    expect(l.lines.join(" ")).toBe(text.toLocaleUpperCase("ru-RU").trim().split(/\s+/).join(" "));
  });

  it("слово шире колонки уменьшает кегль, а не вылезает за край", () => {
    const l = layoutPunch("Превысокомногорассмотрительствующий тип", alumni, true);
    expect(l.fontSize).toBeLessThan(PUNCH_FONT.max);
    expect(l.lines.every((line) => alumni(line, l.fontSize) <= TEXT_W)).toBe(true);
  });

  it("без картинки шутка по центру карточки и крупнее", () => {
    const l = layoutPunch(SHORT, alumni, false);
    const height = l.lines.length * l.fontSize * l.lineHeight;
    expect(l.fontSize).toBeGreaterThan(PUNCH_FONT.max);
    expect(l.top + height / 2).toBeCloseTo(CARD_H / 2);
  });

  it("без картинки даже 140 знаков не доходят до ярлыка внизу", () => {
    const l = layoutPunch(LONG.padEnd(140, " и").slice(0, 140), alumni, false);
    const height = l.lines.length * l.fontSize * l.lineHeight;
    expect(l.top + height).toBeLessThanOrEqual(LABEL_Y_NO_IMAGE - 60);
  });
});

describe("wrap", () => {
  it("переносит по словам и не теряет слов", () => {
    const lines = wrap("раз два три четыре", 100, alumni, 400);
    expect(lines.join(" ")).toBe("раз два три четыре");
    expect(lines.length).toBeGreaterThan(1);
  });
});

it("noImageBg: соседние карточки разного цвета", () => {
  expect(noImageBg(0)).not.toBe(noImageBg(1));
});
