import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import { cardTones, type CardTone } from "./Card";

/** Тег (§4.1 radius.s): «Бесплатно», «Скоро», «Пекло» */
export function Tag({
  tone = "paper",
  children,
  className,
}: {
  tone?: CardTone | "pink";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-sm border-2 border-ink px-2.5 py-1 type-label",
        tone === "pink" ? "bg-pink text-ink" : cardTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
