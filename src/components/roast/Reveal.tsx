"use client";

import { useEffect, useRef, type ElementType, type HTMLAttributes } from "react";
import { cx } from "@/components/cx";

/**
 * Появление блока при скролле (DESIGN.md §9): translateY(16px) + opacity, 400 мс, один раз.
 * delay — мс, для лесенки карточек.
 */
export function Reveal({
  as: Tag = "div",
  delay = 0,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: ElementType; delay?: number }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.dataset.shown = "true";
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={cx(
        "translate-y-4 opacity-0 transition-[opacity,translate] duration-[400ms] ease-[var(--ease-poster)] data-[shown=true]:translate-y-0 data-[shown=true]:opacity-100 motion-reduce:translate-y-0 motion-reduce:opacity-100",
        className,
      )}
      style={{ transitionDelay: `${delay}ms`, ...style }}
      {...props}
    />
  );
}
