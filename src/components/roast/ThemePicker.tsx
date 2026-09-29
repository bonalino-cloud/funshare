import Link from "next/link";
import { cx } from "@/components/cx";

const options = [
  { id: "dark", label: "Тёмная" },
  { id: "light", label: "Светлая" },
  { id: "color", label: "Цветная" },
] as const;

/** Временный переключатель темы hero для выбора. Удалить вместе с ?theme= после решения. */
export function ThemePicker({ current }: { current: string }) {
  return (
    <nav
      aria-label="Тема hero"
      className="fixed top-20 left-4 z-50 flex gap-1 rounded-md border-2 border-ink bg-paper p-1 shadow-offset max-md:top-auto max-md:right-4 max-md:bottom-4 max-md:left-auto"
    >
      {options.map((o) => (
        <Link
          key={o.id}
          href={`/roast?theme=${o.id}`}
          scroll={false}
          className={cx(
            "rounded-sm px-3 py-1.5 type-label text-ink",
            current === o.id ? "bg-pink" : "hover:bg-base-pattern/10",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
