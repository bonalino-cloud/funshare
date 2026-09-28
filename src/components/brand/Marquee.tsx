import { cx } from "@/components/cx";
import { Flower } from "./Flower";

/**
 * Бегущая лента «✱ 2027 ✱ FUNSHARE ✱» (реф Jiva). Разделитель секций лендинга.
 * Контент дублируется, чтобы петля шла без шва.
 */
export function Marquee({ items, className }: { items: string[]; className?: string }) {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-4 px-4">
          <Flower className="size-4" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div
      className={cx(
        "overflow-hidden bg-ink py-2 font-condensed text-xl font-extrabold tracking-wide text-lime uppercase",
        className,
      )}
    >
      <div className="flex w-max animate-marquee">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
