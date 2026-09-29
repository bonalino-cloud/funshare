"use client";

import { useRef, type ReactNode } from "react";
import { cx } from "@/components/cx";
import { Asterisk } from "./Asterisk";

type Tone = "acid" | "yellow" | "red" | "orange" | "paper" | "ink";

const tones: Record<Tone, string> = {
  acid: "bg-acid text-ink",
  yellow: "bg-yellow text-ink",
  red: "bg-red text-ink",
  orange: "bg-orange text-ink",
  paper: "bg-paper text-ink",
  ink: "bg-ink text-paper",
};

/**
 * Бегущая строка (DESIGN.md §8.6): ✱ между пунктами, бесконечная прокрутка.
 * Пункты могут быть стикерами. Может лежать в наклоне (tilt, градусы).
 * Отклик: при наведении лента плавно замедляется, пункт под курсором подпрыгивает.
 */
export function Marquee({
  items,
  tone = "acid",
  tilt = 0,
  reverse = false,
  size = "sm",
  className,
}: {
  items: ReactNode[];
  tone?: Tone;
  tilt?: number;
  reverse?: boolean;
  size?: "sm" | "lg";
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const rate = useRef({ cur: 1, target: 1, raf: 0 });

  const ease = (target: number) => {
    const r = rate.current;
    r.target = target;
    cancelAnimationFrame(r.raf);
    const tick = () => {
      r.cur += (r.target - r.cur) * 0.08;
      track.current?.getAnimations().forEach((a) => (a.playbackRate = r.cur));
      if (Math.abs(r.target - r.cur) > 0.01) r.raf = requestAnimationFrame(tick);
    };
    tick();
  };

  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {items.map((item, i) => (
        <li key={i} className="flex items-center">
          <span className="inline-flex items-center px-4 transition-transform duration-200 ease-[var(--ease-poster)] hover:-translate-y-1 hover:scale-110 hover:-rotate-3 md:px-6">
            {item}
          </span>
          <Asterisk className={cx("shrink-0", size === "lg" ? "size-5 md:size-7" : "size-3.5")} />
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className={cx(
        "group/mq relative overflow-hidden transition-transform duration-300 ease-[var(--ease-poster)] hover:scale-y-110",
        size === "lg"
          ? "py-2 font-cond text-3xl font-bold tracking-wide uppercase md:py-3 md:text-5xl"
          : "flex h-8 items-center type-ticker",
        tones[tone],
        className,
      )}
      style={{ rotate: `${tilt}deg` }}
      onPointerEnter={() => ease(0.25)}
      onPointerLeave={() => ease(1)}
    >
      <div
        ref={track}
        className={cx("flex w-max", reverse ? "animate-marquee-reverse" : "animate-marquee")}
      >
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
