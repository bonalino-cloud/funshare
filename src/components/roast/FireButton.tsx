"use client";

import { useMemo, type ButtonHTMLAttributes } from "react";
import { cx } from "@/components/cx";
import { ArrowNE } from "@/components/brand/Doodles";

/**
 * Главная кнопка, которая горит. Над верхним краем постоянно пляшет пламя из частиц,
 * склеенных gooey-фильтром в один язык огня. Hover — огонь выше и быстрее,
 * и воронка в hero раскручивается (событие roast:heat).
 * Сама кнопка — Primary из DESIGN.md §8.4: pink, ink-обводка, жёсткая тень.
 */

const PARTICLES = 34;

function heat(value: number) {
  window.dispatchEvent(new CustomEvent("roast:heat", { detail: value }));
}

export function FireButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  // Детерминированный «рандом», чтобы разметка совпадала на сервере и клиенте
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => {
        const r = (n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1;
        // Округляем: иначе строки стилей на сервере и клиенте разойдутся в последних знаках
        return {
          left: Math.round(4 + r(1) * 92),
          size: Math.round(26 + r(2) * 34),
          dur: Math.round((0.9 + r(3) * 0.9) * 100) / 100,
          delay: -Math.round(r(4) * 200) / 100,
          tone: i % 3,
        };
      }),
    [],
  );

  return (
    <span className={cx("group/fire relative inline-block", className)}>
      <svg aria-hidden="true" className="absolute size-0">
        <filter id="fire-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
        </filter>
      </svg>
      {/* Пламя: частицы поднимаются от верхнего края и гаснут */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-1 -top-24 bottom-1/2 origin-bottom [filter:url(#fire-goo)] transition-transform duration-300 group-hover/fire:scale-x-105 group-hover/fire:scale-y-[1.55]"
      >
        <span className="absolute inset-x-2 bottom-0 h-7 rounded-full bg-orange" />
        {particles.map((p, i) => (
          <span
            key={i}
            className={cx(
              "absolute bottom-0 [animation:fire-rise_var(--dur)_ease-in_infinite] rounded-full group-hover/fire:[animation-duration:calc(var(--dur)*0.6)]",
              p.tone === 0 ? "bg-red" : p.tone === 1 ? "bg-orange" : "bg-yellow",
            )}
            style={
              {
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                marginLeft: -p.size / 2,
                animationDelay: `${p.delay}s`,
                "--dur": `${p.dur}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </span>
      <button
        className={cx(
          "relative inline-flex h-16 items-center gap-3 rounded-sm border-2 border-ink bg-pink px-7 text-ink shadow-offset md:h-20 md:px-10",
          "font-wide text-xl font-black tracking-tight uppercase md:text-3xl",
          "transition-[transform,box-shadow] duration-[120ms] ease-linear",
          "hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-offset-hover active:translate-x-1 active:translate-y-1 active:shadow-none",
          "focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-pink",
        )}
        onPointerEnter={() => heat(1)}
        onPointerLeave={() => heat(0)}
        onFocus={() => heat(1)}
        onBlur={() => heat(0)}
        {...props}
      >
        {children}
        <ArrowNE className="size-6 transition-transform duration-200 group-hover/fire:translate-x-1 group-hover/fire:-translate-y-1 md:size-8" />
      </button>
    </span>
  );
}
