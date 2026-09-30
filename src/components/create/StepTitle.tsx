"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "@/components/cx";

/**
 * Строка, которая растягивается на всю ширину колонки: меряем текст при опорном кегле
 * и подбираем размер так, чтобы строка заняла ширину родителя (в пределах min…max).
 * Пересчёт при ресайзе и после загрузки шрифтов.
 */
function FitLine({
  children,
  max,
  min = 22,
  className,
}: {
  children: ReactNode;
  max: number;
  min?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const fit = () => {
      el.style.fontSize = "100px";
      const ratio = parent.clientWidth / Math.max(el.scrollWidth, 1);
      el.style.fontSize = `${Math.max(min, Math.min(max, 100 * ratio))}px`;
    };
    fit();
    document.fonts?.ready.then(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [children, max, min]);

  return (
    <span ref={ref} className={cx("block whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

/**
 * Заголовок шага: Unbounded капс по центру, растянут по ширине колонки (DESIGN.md §3.3).
 * `accent` — наклонная розовая часть; `split` кладёт её отдельной строкой.
 */
export function StepTitle({
  children,
  accent,
  split = false,
  size = "l",
  className,
}: {
  children: ReactNode;
  accent?: ReactNode;
  split?: boolean;
  size?: "l" | "m";
  className?: string;
}) {
  const max = size === "l" ? 64 : 56;
  const accentNode = accent && <span className="tilt text-pink">{accent}</span>;
  return (
    <h1
      className={cx(
        "relative z-20 mb-2.5 text-center font-wide leading-[0.92] font-black tracking-tight text-paper uppercase",
        className,
      )}
    >
      {split && accent ? (
        <>
          <FitLine max={max}>{children}</FitLine>
          <FitLine max={max}>{accentNode}</FitLine>
        </>
      ) : (
        <FitLine max={max}>
          {children}
          {accentNode && <> {accentNode}</>}
        </FitLine>
      )}
    </h1>
  );
}

/** Подзаголовок шага */
export function StepLead({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-center type-lead text-paper/70">{children}</p>;
}
