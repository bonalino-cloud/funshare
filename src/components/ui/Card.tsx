import type { HTMLAttributes } from "react";
import { cx } from "@/components/cx";

export type CardTone =
  "cobalt" | "red" | "yellow" | "teal" | "violet" | "acid" | "orange" | "paper";

/** Заливка → цвет текста (§2.3). Пары фиксированы: не менять текст отдельно от фона */
export const cardTones: Record<CardTone, string> = {
  cobalt: "bg-cobalt text-paper",
  red: "bg-red text-ink",
  yellow: "bg-yellow text-ink",
  teal: "bg-teal text-ink",
  violet: "bg-violet text-paper",
  acid: "bg-acid text-ink",
  orange: "bg-orange text-ink",
  paper: "bg-paper text-ink",
};

/**
 * Карточка: filled (§8.1, язык постера) или outlined (§8.2, язык сайта).
 * Иллюстрация внутри всегда обрезается краем, стикер-бейдж выходит за край — overflow по месту.
 */
export function Card({
  tone = "paper",
  outlined = false,
  onLight = false,
  grain = true,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: CardTone;
  /** Чёрная карточка с белой обводкой 2px */
  outlined?: boolean;
  /** Outlined на светлом фоне получает offset-тень */
  onLight?: boolean;
  grain?: boolean;
}) {
  return (
    <div
      className={cx(
        "relative",
        outlined
          ? cx(
              "rounded-md border-2 border-white bg-ink p-4 text-paper",
              onLight && "border-ink shadow-offset",
            )
          : cx("rounded-lg p-5 md:p-6", cardTones[tone], grain && "grain"),
        className,
      )}
      {...props}
    />
  );
}
