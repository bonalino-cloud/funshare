import type { HTMLAttributes } from "react";
import { cx } from "@/components/cx";

export type BlockTone =
  | "cobalt"
  | "tomato"
  | "sun"
  | "mint"
  | "violet"
  | "bubblegum"
  | "lime"
  | "flame"
  | "paper"
  | "ink"
  | "accent";

/** Цвет блока → фон и цвет текста. Пары подобраны по контрасту, не менять по одной. */
export const blockTones: Record<BlockTone, string> = {
  cobalt: "bg-cobalt text-paper",
  tomato: "bg-tomato text-ink",
  sun: "bg-sun text-ink",
  mint: "bg-mint text-ink",
  violet: "bg-violet text-paper",
  bubblegum: "bg-bubblegum text-ink",
  lime: "bg-lime text-ink",
  flame: "bg-flame text-ink",
  paper: "bg-paper text-ink",
  ink: "bg-ink-2 text-paper ring-1 ring-ink-3",
  accent: "bg-accent text-on-accent",
};

/**
 * Базовый кирпич любого экрана: цветной блок со скруглением, зерном и тенью
 * (рефы MERSHE и Jiva). Экраны собираются из блоков в «бенто»-сетку на тёмном холсте.
 */
export function Block({
  tone = "paper",
  grain = true,
  flush = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: BlockTone;
  grain?: boolean;
  /** Без внутренних отступов — для составных блоков из нескольких цветных частей */
  flush?: boolean;
}) {
  return (
    <div
      className={cx(
        "relative rounded-card shadow-block",
        !flush && "p-6 md:p-8",
        grain && "grain",
        blockTones[tone],
        className,
      )}
      {...props}
    />
  );
}
