import { Dela_Gothic_One, Inter_Tight, Sofia_Sans_Extra_Condensed } from "next/font/google";

// Все три шрифта с кириллицей — проверено по font-data.json в next/font.

/** Заголовки и текст: плотный гротеск, как «TANOSHII PARK» в рефе */
export const interTight = Inter_Tight({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter-tight",
  display: "swap",
});

/** Узкие акценты: навигация, списки, ленты — как «LINEUP / DATE» в Jiva */
export const sofiaCondensed = Sofia_Sans_Extra_Condensed({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sofia-condensed",
  display: "swap",
});

/** Стикеры и бейджи: жирный мягкий гротеск, как «BORN BÔNG» */
export const delaGothic = Dela_Gothic_One({
  subsets: ["latin", "cyrillic"],
  weight: "400",
  variable: "--font-dela-gothic",
  display: "swap",
});

export const fontVariables = [
  interTight.variable,
  sofiaCondensed.variable,
  delaGothic.variable,
].join(" ");
