import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/cx";
import { ArrowUpRight } from "@/components/brand/Doodles";

type Variant = "accent" | "ink" | "paper" | "ghost";

const variants: Record<Variant, string> = {
  accent: "bg-accent text-on-accent",
  ink: "bg-ink text-paper [--btn-icon:var(--accent)] [--btn-icon-fg:var(--on-accent)]",
  paper: "bg-paper text-ink",
  ghost: "bg-transparent text-paper ring-2 ring-inset ring-paper/60 hover:ring-paper",
};

/**
 * Кнопка-пилюля: жирный капс + иконка в круге (реф Jiva «NOTIFY ME! ASAP»).
 * На hover чуть наклоняется и приподнимается — фестивальная «живость».
 * На блоке цвета акцента используй variant="ink", иначе кнопка сольётся с фоном.
 */
export function Button({
  variant = "accent",
  icon = <ArrowUpRight className="size-4" />,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode | null }) {
  return (
    <button
      className={cx(
        "group inline-flex min-h-13 items-center justify-center gap-3 rounded-chip py-2 pr-2 pl-6 type-eyebrow text-base",
        "transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:-rotate-1 active:translate-y-0 active:rotate-0",
        "focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-sun disabled:opacity-50",
        !icon && "pr-6",
        variants[variant],
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {icon && (
        <span className="grid size-9 place-items-center rounded-full bg-[var(--btn-icon,var(--color-ink))] text-[color:var(--btn-icon-fg,var(--color-paper))] transition-transform duration-300 ease-bounce group-hover:rotate-45">
          {icon}
        </span>
      )}
    </button>
  );
}
