import { cx } from "@/components/cx";
import { FunshareLogo } from "@/components/brand/FunshareLogo";

/**
 * Шапка (DESIGN.md §8.11): логотип Funshare + «/ прожарка» слева, бургер справа, 56 px, прозрачная поверх hero.
 */
export function RoastNav({ className }: { className?: string }) {
  return (
    <header
      className={cx(
        "relative z-20 flex h-14 items-center justify-between px-4 md:h-16 md:px-6",
        className,
      )}
    >
      <a
        href="#"
        className="group/logo flex items-center gap-2.5 type-label text-sm text-on-surface"
      >
        <FunshareLogo className="h-7 w-auto md:h-8" />
        <span className="opacity-60">/ прожарка</span>
      </a>
      <button
        type="button"
        aria-label="Меню"
        className="group/burger grid size-11 place-items-center rounded-sm border-2 border-ink bg-paper text-ink shadow-offset transition-[transform,box-shadow] duration-[120ms] ease-linear hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-offset-hover"
      >
        <span className="flex w-5 flex-col items-end gap-1">
          <span className="h-0.5 w-5 bg-ink transition-all duration-200 group-hover/burger:w-3" />
          <span className="h-0.5 w-5 bg-ink" />
          <span className="h-0.5 w-3 bg-ink transition-all duration-200 group-hover/burger:w-5" />
        </span>
      </button>
    </header>
  );
}
