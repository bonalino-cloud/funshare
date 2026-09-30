import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/cx";
import { ArrowNE } from "@/components/brand/Doodles";

type Variant = "primary" | "secondary" | "inverse" | "ghost";

/** Заливка, обводка и тень задаются вместе: у ghost нет тени и обводка белая */
const variants: Record<Variant, string> = {
  primary: "border-ink bg-pink text-ink shadow-offset hover:shadow-offset-hover",
  secondary: "border-ink bg-orange text-ink shadow-offset hover:shadow-offset-hover",
  inverse: "border-ink bg-white text-ink shadow-offset hover:shadow-offset-hover",
  ghost: "border-white bg-transparent text-paper",
};

/**
 * Кнопка (DESIGN.md §8.4): плоская заливка, ink-обводка 2px, radius.s, жёсткая offset-тень.
 * ghost — второстепенное действие на тёмном («Пропустить»): прозрачная, белая обводка, без тени.
 * Hover — тень 2px и сдвиг на 2px, active — тень 0 и сдвиг на 4px. Linear: жёсткость — часть характера.
 */
export function Button({
  variant = "primary",
  look = "label",
  icon,
  arrow = true,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** label — Onest капс с разрядкой; display — Unbounded, как у «Прожарить» на лендинге */
  look?: "label" | "display";
  icon?: ReactNode;
  arrow?: boolean;
}) {
  return (
    <button
      className={cx(
        "group inline-flex h-12 items-center justify-center gap-2 rounded-sm border-2 px-5",
        look === "display"
          ? "font-wide font-black tracking-tight text-base uppercase"
          : "type-label text-sm",
        "transition-[transform,box-shadow] duration-[120ms] ease-linear",
        "hover:translate-x-0.5 hover:translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-none",
        "focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-pink",
        "disabled:pointer-events-none disabled:border-transparent disabled:bg-base-pattern disabled:text-[#555] disabled:shadow-none",
        variants[variant],
        className,
      )}
      {...props}
    >
      {icon && <span className="size-5 shrink-0">{icon}</span>}
      <span>{children}</span>
      {arrow && (
        <ArrowNE className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      )}
    </button>
  );
}
