import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/cx";
import { ArrowNE } from "@/components/brand/Doodles";

type Variant = "primary" | "secondary" | "inverse";

const variants: Record<Variant, string> = {
  primary: "bg-pink",
  secondary: "bg-orange",
  inverse: "bg-white",
};

/**
 * Кнопка (DESIGN.md §8.4): плоская заливка, ink-обводка 2px, radius.s, жёсткая offset-тень.
 * Hover — тень 2px и сдвиг на 2px, active — тень 0 и сдвиг на 4px. Linear: жёсткость — часть характера.
 */
export function Button({
  variant = "primary",
  icon,
  arrow = true,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  icon?: ReactNode;
  arrow?: boolean;
}) {
  return (
    <button
      className={cx(
        "group inline-flex h-12 items-center justify-center gap-2 rounded-sm border-2 border-ink px-5 type-label text-sm text-ink shadow-offset",
        "transition-[transform,box-shadow] duration-[120ms] ease-linear",
        "hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-offset-hover active:translate-x-1 active:translate-y-1 active:shadow-none",
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
