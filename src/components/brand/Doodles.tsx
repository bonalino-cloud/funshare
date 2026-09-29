import type { CSSProperties, ReactNode, SVGProps } from "react";
import { cx } from "@/components/cx";

/** ↗ — универсальный указатель действия (§6.2). Stroke 2px */
export function ArrowNE(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 18 18 6M8 6h10v10" strokeLinecap="square" />
    </svg>
  );
}

/** ↘ — декоративный указатель на условие или приз (§6.2) */
export function ArrowSE(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 6 18 18M18 8v10H8" strokeLinecap="square" />
    </svg>
  );
}

/** Рукописная дудл-стрелка с петлёй. Кончик смотрит вправо-вниз; поворачивай через rotate */
export function DoodleArrow(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 140 110"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 18 C 40 4, 78 10, 70 36 C 64 56, 36 50, 46 34 C 58 16, 102 30, 118 86" />
      <path d="M100 76 L 119 90 L 128 67" />
    </svg>
  );
}

/** Волнистое подчёркивание слова (§3.3): pink, stroke 3px, векторный путь */
export function Squiggle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("relative inline-block", className)}>
      {children}
      <svg
        viewBox="0 0 120 12"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute -bottom-[0.16em] left-0 h-[0.14em] w-full text-pink"
      >
        <path
          d="M2 6 q7.5 -8 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

/** Обвод-овал (§3.3): рукописный эллипс red, не замкнут, перекрывает буквы */
export function Circled({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={cx("relative inline-block px-[0.1em]", className)} style={style}>
      <svg
        viewBox="0 0 200 80"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute -inset-x-[0.18em] -inset-y-[0.12em] h-[124%] w-[calc(100%+0.36em)] text-red"
      >
        <path
          d="M18 44 C 10 14, 150 4, 186 26 C 204 40, 170 72, 96 74 C 34 76, 4 60, 22 34"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

/** edge.zigzag (§4.4): зубчатый край между секциями. Цвет — currentColor (цвет следующей секции) */
export function ZigzagEdge({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 360 16"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cx("block h-4 w-full", className)}
    >
      <path
        fill="currentColor"
        d={`M0 16 ${Array.from({ length: 20 }, (_, i) => `L${i * 18 + 9} 0 L${i * 18 + 18} 16`).join(" ")} Z`}
      />
    </svg>
  );
}

/** edge.flame (§4.4): плоское пламя orange + yellow перед CTA и футером */
export function FlameEdge({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 60"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cx("block h-12 w-full md:h-16", className)}
    >
      <path
        className="fill-orange"
        d="M0 60 L0 34 Q10 10 20 30 Q26 2 40 26 Q50 0 62 30 Q74 8 84 24 Q96 -4 108 28 Q120 6 132 26 Q142 0 156 30 Q168 8 178 22 Q190 -2 202 28 Q214 6 226 26 Q236 0 250 30 Q262 8 272 22 Q284 -2 296 28 Q308 6 320 26 Q330 0 344 30 Q356 8 366 22 Q378 0 390 28 Q396 18 400 30 L400 60 Z"
      />
      <path
        className="fill-yellow"
        d="M0 60 L0 46 Q12 30 22 44 Q32 24 44 42 Q56 26 66 44 Q78 28 90 42 Q102 22 114 44 Q126 30 136 42 Q148 24 160 44 Q172 28 182 42 Q194 22 206 44 Q218 30 228 42 Q240 24 252 44 Q264 28 274 42 Q286 22 298 44 Q310 30 320 42 Q332 24 344 44 Q356 28 366 42 Q378 24 390 44 L400 44 L400 60 Z"
      />
    </svg>
  );
}
