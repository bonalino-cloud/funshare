import Link from "next/link";
import { cx } from "@/components/cx";
import { FunshareLogo } from "@/components/brand/FunshareLogo";
import { HistoryButton } from "./HistoryButton";

/**
 * Шапка (DESIGN.md §8.11): логотип Funshare слева, справа часики «Мои прожарки», 56 px,
 * прозрачная поверх hero.
 */
export function RoastNav({ className }: { className?: string }) {
  return (
    <header
      className={cx(
        "relative z-20 flex h-14 items-center justify-between px-4 md:h-16 md:px-6",
        className,
      )}
    >
      <Link
        href="/"
        className="group/logo flex items-center gap-2.5 type-label text-sm text-on-surface"
      >
        <FunshareLogo className="h-7 w-auto md:h-8" />
      </Link>
      <HistoryButton />
    </header>
  );
}
