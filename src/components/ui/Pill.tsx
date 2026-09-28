import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import { blockTones, type BlockTone } from "./Block";

/** Тег-пилюля: «Every Saturday», «2027», «Для друга» */
export function Pill({
  tone = "ink",
  children,
  className,
}: {
  tone?: BlockTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-chip px-3.5 py-1.5 type-eyebrow",
        blockTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
