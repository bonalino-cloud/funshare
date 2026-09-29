import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import { ParallaxScope } from "./ParallaxScope";
import { RevealText, type RevealSegment } from "./RevealText";

export type Surface = "dark" | "light" | "color";

/**
 * Этаж лендинга (DESIGN.md §9.1): поверхность задаётся data-surface, параллакс внутри — через --mx/--my/--sy.
 */
export function Section({
  id,
  surface,
  className,
  children,
}: {
  id?: string;
  surface: Surface;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ParallaxScope
      id={id}
      data-surface={surface}
      className={cx("relative isolate overflow-hidden bg-surface text-on-surface", className)}
    >
      {children}
    </ParallaxScope>
  );
}

/** Заголовок секции: метка в углу + огромный condensed H2, проявляется по буквам */
export function SectionHeading({
  label,
  lines,
  className,
}: {
  label?: string;
  lines: RevealSegment[][];
  className?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      {label && <p className="mb-4 type-label text-[color:var(--muted)]">{label}</p>}
      <RevealText as="h2" className="type-cond-hero" step={26} lines={lines} />
    </div>
  );
}
