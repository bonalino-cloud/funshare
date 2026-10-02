import type { StaticImageData } from "next/image";
import atTagSvg from "./assets/at-tag.svg";
import logoMarkSvg from "./assets/logo-mark.svg";
import timesSvg from "./assets/times.svg";

// Next типизирует импорт .svg как any (ради svgr); у нас это обычный статический файл
const logoMark = logoMarkSvg as StaticImageData;
const atTag = atTagSvg as StaticImageData;
const times = timesSvg as StaticImageData;

/**
 * Строка над карточками (Figma FUNSHARE, узел 29:2780): «😉 FUNSHARE × @ НИК».
 * Иконки — файлы из макета как есть; меняется только ник профиля, всё по центру.
 */
export function CoBrand({ username }: { username: string }) {
  const label =
    "font-wide text-[10px] leading-none font-bold tracking-[-0.39px] text-white uppercase";
  return (
    <div className="flex items-center justify-center gap-[18px]">
      <span className="flex items-center gap-1.5">
        {/* SVG из макета: размеры берём из самого файла, не растягиваем */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoMark.src} width={logoMark.width} height={logoMark.height} alt="" />
        <span className={label}>Funshare</span>
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={times.src} width={times.width} height={times.height} alt="" aria-hidden="true" />
      <span className="flex min-w-0 items-center gap-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={atTag.src} width={atTag.width} height={atTag.height} alt="" />
        <span className={`${label} truncate`}>{username}</span>
      </span>
    </div>
  );
}
