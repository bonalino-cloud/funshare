"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/cx";

/** Срабатывает один раз, когда элемент попал в экран */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setInView(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

/** Счётчик, который досчитывает до to, когда попал в экран («Считаем закаты… 47») */
export function Counter({ to, className }: { to: number; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 1800, 1);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);
  return (
    <span ref={ref} className={cx("tabular-nums", className)}>
      {n}
    </span>
  );
}

/** Печатает текст по буквам, когда попал в экран, и мигает кареткой */
export function Typewriter({ text, className }: { text: string; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const [len, setLen] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setLen((l) => (l >= text.length ? l : l + 1)), 70);
    return () => clearInterval(id);
  }, [inView, text]);
  return (
    <span ref={ref} className={className} aria-label={text}>
      <span aria-hidden="true">{text.slice(0, len)}</span>
      <span
        aria-hidden="true"
        className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[0.15em] animate-pulse bg-current"
      />
    </span>
  );
}

const STAGES = ["Rare", "Medium", "Well done"];

/** Шкала прожарки: заполняется до Well done, при наведении прожаривает заново */
export function DonenessMeter({ className }: { className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => setFilled(true), 300);
    return () => clearTimeout(t);
  }, [inView]);
  const replay = () => {
    setFilled(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setFilled(true)));
  };
  return (
    <div ref={ref} className={className} onPointerEnter={replay}>
      <div className="relative h-5 overflow-hidden rounded-full border-2 border-paper bg-base-pattern">
        {/* Три плоских сегмента жёсткими стопами — не градиент */}
        <div
          className={cx(
            "h-full origin-left bg-[linear-gradient(90deg,var(--color-yellow)_0_33%,var(--color-orange)_33%_66%,var(--color-red)_66%_100%)] ease-[var(--ease-poster)]",
            filled ? "scale-x-100 transition-transform duration-[1800ms]" : "scale-x-0",
          )}
        />
      </div>
      <div className="mt-2 flex justify-between type-label">
        {STAGES.map((s, i) => (
          <span key={s} className={cx(i === STAGES.length - 1 && "text-orange")}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
