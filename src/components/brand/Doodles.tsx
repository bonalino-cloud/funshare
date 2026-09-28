import type { ReactNode, SVGProps } from "react";
import { cx } from "@/components/cx";

/** Стрелка ↗ у кликабельных строк и карточек (реф Jiva) */
export function ArrowUpRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 17 17 7M8 7h9v9" strokeLinecap="square" />
    </svg>
  );
}

/** Волнистое подчёркивание слова — розовая «змейка» под заголовком */
export function Squiggle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("relative inline-block", className)}>
      {children}
      <svg
        viewBox="0 0 120 12"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute -bottom-[0.18em] left-0 h-[0.16em] w-full text-bubblegum"
      >
        <path
          d="M2 6 q7.5 -8 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** Слово, обведённое от руки эллипсом (реф LADIES NIGHT) */
export function Circled({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("relative inline-block px-[0.12em]", className)}>
      <svg
        viewBox="0 0 200 80"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute -inset-x-[0.2em] -inset-y-[0.15em] h-[130%] w-[calc(100%+0.4em)] text-tomato"
      >
        <path
          d="M18 44 C 10 14, 150 4, 186 26 C 204 40, 170 72, 96 74 C 34 76, 4 60, 22 34"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

/** Край-пламя для перехода между секциями (реф Jiva). Цвет — currentColor. */
export function FlameEdge({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 40"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cx("block h-8 w-full", className)}
    >
      <path
        fill="currentColor"
        d="M0 40 L0 22 Q14 4 22 20 Q30 0 44 18 Q56 2 66 22 Q80 6 90 16 Q104 -2 114 20 Q128 4 138 18 Q150 0 162 22 Q176 6 186 16 Q198 -2 210 20 Q224 4 234 18 Q246 0 258 22 Q272 6 282 16 Q294 -2 306 20 Q320 4 330 18 Q342 0 354 22 Q368 6 378 16 Q390 2 400 20 L400 40 Z"
      />
    </svg>
  );
}
