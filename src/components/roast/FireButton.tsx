"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/components/cx";
import { ArrowNE } from "@/components/brand/Doodles";
import { Flames } from "./Flames";

/**
 * Главная кнопка, которая горит: пламя (Flames) растёт из верхнего края.
 * Hover — огонь выше и быстрее, воронка в hero раскручивается (событие roast:heat).
 * Сама кнопка — Inverse из DESIGN.md §8.4: white, ink-обводка, жёсткая тень.
 */

function heat(value: number) {
  window.dispatchEvent(new CustomEvent("roast:heat", { detail: value }));
}

export function FireButton({
  className,
  children,
  size = "lg",
  cut,
  href,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "lg" | "sm";
  /** Цвет вырезов пламени = цвет фона вокруг кнопки; null — без вырезов */
  cut?: string | null;
  /** Со ссылкой кнопка становится <Link>: главный CTA ведёт во флоу создания */
  href?: string;
}) {
  const lg = size === "lg";
  const buttonClass = cx(
    "relative inline-flex items-center gap-3 rounded-sm border-2 border-ink bg-white text-ink shadow-offset",
    "font-wide font-black tracking-tight uppercase",
    lg ? "h-16 px-7 text-xl md:h-20 md:px-10 md:text-3xl" : "h-12 px-5 text-sm",
    "transition-[transform,box-shadow] duration-[120ms] ease-linear",
    "hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-offset-hover active:translate-x-1 active:translate-y-1 active:shadow-none",
    "focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-pink",
  );
  const inner = (
    <>
      {children}
      <ArrowNE
        className={cx(
          "transition-transform duration-200 group-hover/fire:translate-x-1 group-hover/fire:-translate-y-1",
          lg ? "size-6 md:size-8" : "size-4",
        )}
      />
    </>
  );
  const heatHandlers = {
    onPointerEnter: () => heat(1),
    onPointerLeave: () => heat(0),
    onFocus: () => heat(1),
    onBlur: () => heat(0),
  };
  return (
    <span className={cx("group/fire relative inline-block", className)}>
      <Flames
        particle={lg ? "lg" : "sm"}
        cut={cut}
        className={cx(
          "bottom-1/2 group-hover/fire:scale-y-[1.35]",
          lg
            ? "inset-x-3 h-28 [--rise:-100px] md:h-40 md:[--rise:-150px]"
            : "inset-x-2 h-16 [--rise:-60px]",
        )}
      />
      {href ? (
        <Link href={href} className={buttonClass} {...heatHandlers}>
          {inner}
        </Link>
      ) : (
        <button className={buttonClass} {...heatHandlers} {...props}>
          {inner}
        </button>
      )}
    </span>
  );
}
