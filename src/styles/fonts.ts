import { Alumni_Sans, JetBrains_Mono, Onest, Unbounded, Yanone_Kaffeesatz } from "next/font/google";

// Night Poster (DESIGN.md §3). Все четыре с кириллицей — проверено по font-data.json в next/font.

/** Display Wide: H1, hero, названия событий */
export const unbounded = Unbounded({
  // Вариативный: заголовки секций берут разную жирность на каждую букву (RevealText jitter)
  subsets: ["latin", "cyrillic"],
  variable: "--font-unbounded",
  display: "swap",
});

/** Display Condensed: H2, лейблы-тикеры, всё «афишное» */
export const yanone = Yanone_Kaffeesatz({
  subsets: ["latin", "cyrillic"],
  weight: "700",
  variable: "--font-yanone",
  display: "swap",
});

/** Text: описания, меню, кнопки */
export const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
  variable: "--font-onest",
  display: "swap",
});

/** Mono: счётчики, коды, даты */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  weight: "700",
  variable: "--font-jetbrains",
  display: "swap",
});

/**
 * Шутка в карточке артефакта. В макете DIN Condensed Bold: он системный в macOS и по лицензии
 * Apple не едет ни на сайт, ни на сервер. Alumni Sans 700 ближе всех по ширине строки.
 */
export const alumni = Alumni_Sans({
  subsets: ["latin", "cyrillic"],
  weight: "700",
  variable: "--font-alumni",
  display: "swap",
});

export const fontVariables = [
  unbounded.variable,
  yanone.variable,
  onest.variable,
  jetbrainsMono.variable,
  alumni.variable,
].join(" ");
