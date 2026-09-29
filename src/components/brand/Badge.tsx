import { cx } from "@/components/cx";
import { Asterisk } from "./Asterisk";

type Variant = "violet" | "paper" | "ring";

const variants: Record<Variant, string> = {
  violet: "bg-violet text-white",
  paper: "bg-paper text-ink",
  ring: "bg-transparent text-ink ring-4 ring-inset ring-ink",
};

/**
 * Стикер-бейдж (DESIGN.md §6.5): круг с ✱ в центре на 50 % диаметра.
 * Ставится на стык двух карточек или на край одной, выходя за границу на 30–50 %.
 */
export function Badge({
  variant = "violet",
  spin = true,
  className,
}: {
  variant?: Variant;
  spin?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid size-20 place-items-center rounded-full transition-transform duration-200 hover:rotate-6 md:size-28",
        variants[variant],
        className,
      )}
    >
      <Asterisk className={cx("size-1/2", spin && "animate-spin-slow")} />
    </span>
  );
}
