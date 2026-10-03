"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/cx";
import {
  cardFontsReady,
  cardLayout,
  NICK_FAMILY,
  PUNCH_FAMILY,
  type RoastCardData,
} from "@/lib/client/roast-card";
import {
  CARD_W,
  IMAGE,
  LABEL,
  labelY,
  NICK,
  PAD_X,
  SEAM_H,
  TEXT_W,
  type PunchLayout,
} from "./card-layout";

/** Единицы макета → ширина карточки: карточка тянется по контейнеру, пропорции макета 1080×1920. */
const u = (n: number) => `calc(${n} * 100cqw / ${CARD_W})`;

/**
 * Карточка прожарки 9:16 по макету Figma (Card Short / Medium / Long). Строки шутки
 * считает `cardLayout` после загрузки шрифтов: те же, что попадут в PNG.
 */
export function RoastCard({
  card,
  className,
  priority = false,
}: {
  card: RoastCardData;
  className?: string;
  priority?: boolean;
}) {
  const [layout, setLayout] = useState<PunchLayout | null>(null);

  useEffect(() => {
    let alive = true;
    cardFontsReady().then(() => alive && setLayout(cardLayout(card)));
    return () => {
      alive = false;
    };
  }, [card]);

  return (
    <figure
      className={cx(
        "[container-type:inline-size] relative m-0 aspect-[9/16] w-full overflow-hidden",
        className,
      )}
      // Цвета карточки из макета, а не из темы: это картинка для сторис, не интерфейс
      style={{ backgroundColor: card.bg, color: "#000" }}
      aria-label={`@${card.username}: ${card.text}`}
    >
      {card.image && (
        <div className="absolute inset-x-0" style={{ top: u(IMAGE.top), height: u(IMAGE.size) }}>
          {/* Картинки из Blob: домены переменные, поэтому <img> */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.image.url}
            alt={card.image.alt}
            className="size-full object-cover"
            loading={priority ? "eager" : "lazy"}
            draggable={false}
          />
          <div
            className="absolute inset-x-0 top-0"
            style={{
              height: u(SEAM_H),
              background: `linear-gradient(${card.bg}, ${card.bg}00)`,
            }}
          />
        </div>
      )}

      <div
        className="absolute font-bold whitespace-nowrap uppercase"
        style={{
          left: u(PAD_X),
          top: u(NICK.top),
          fontFamily: NICK_FAMILY,
          fontSize: u(NICK.size),
          lineHeight: 1.24,
        }}
      >
        {card.username}
      </div>

      <figcaption
        className={cx(
          "absolute font-bold whitespace-nowrap uppercase transition-opacity duration-200",
          !layout && "opacity-0",
        )}
        style={{
          left: u(PAD_X),
          width: u(TEXT_W),
          top: u(layout?.top ?? 0),
          fontFamily: PUNCH_FAMILY,
          fontSize: u(layout?.fontSize ?? 0),
          lineHeight: layout?.lineHeight,
        }}
      >
        {layout?.lines.map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </figcaption>

      <div
        className="absolute flex items-center justify-center"
        style={{
          left: u(LABEL.x),
          top: u(labelY(card.image !== null)),
          width: u(LABEL.w),
          height: u(LABEL.h),
          borderRadius: u(LABEL.radius),
          backgroundColor: "#fff",
        }}
        aria-hidden
      >
        <span
          className="-rotate-90 font-bold whitespace-nowrap"
          style={{ fontFamily: NICK_FAMILY, fontSize: u(LABEL.size), lineHeight: 1 }}
        >
          {LABEL.text}
        </span>
      </div>
    </figure>
  );
}
