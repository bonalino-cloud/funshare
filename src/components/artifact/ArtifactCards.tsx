"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cx } from "@/components/cx";
import { renderCardPng, type RoastCardData } from "@/lib/client/roast-card";
import { RoastCard } from "./RoastCard";

/**
 * Карточки артефакта лентой со свайпом, как сторис. Ширина карточки подстраивается
 * под высоту экрана, чтобы под ней оставались кнопки.
 */
export function ArtifactCards({
  cards,
  onIndex,
  reserve = 300,
}: {
  cards: RoastCardData[];
  onIndex?: (i: number) => void;
  /** Сколько px высоты экрана занято вокруг карточки: шапка, кнопки. */
  reserve?: number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.index);
          setIndex(i);
          onIndex?.(i);
        }
      },
      { root: el, threshold: 0.6 },
    );
    for (const child of el.children) io.observe(child);
    return () => io.disconnect();
  }, [cards, onIndex]);

  function go(i: number) {
    const el = track.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  return (
    <div
      className="[container-type:inline-size] flex w-full flex-col items-center gap-3"
      style={
        {
          "--card-w": `max(220px, min(100cqw, calc((100dvh - ${reserve}px) * 9 / 16)))`,
        } as CSSProperties
      }
    >
      <div
        ref={track}
        className="flex w-full snap-x snap-mandatory [scrollbar-width:none] gap-3 overflow-x-auto overscroll-x-contain px-[max(0px,calc((100cqw-var(--card-w))/2))] [&::-webkit-scrollbar]:hidden"
        aria-roledescription="карусель"
        aria-label="Карточки прожарки"
      >
        {cards.map((card, i) => (
          <div
            key={card.punchId}
            data-index={i}
            className="w-(--card-w) shrink-0 snap-center"
            aria-roledescription="карточка"
            aria-label={`${i + 1} из ${cards.length}`}
          >
            <RoastCard card={card} priority={i === 0} className="rounded-lg" />
          </div>
        ))}
      </div>
      {cards.length > 1 && (
        <div className="flex gap-2" role="tablist" aria-label="Выбор карточки">
          {cards.map((card, i) => (
            <button
              key={card.punchId}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Карточка ${i + 1}`}
              onClick={() => go(i)}
              className={cx(
                "h-2 rounded-full transition-all duration-200",
                i === index ? "w-6 bg-paper" : "w-2 bg-paper/35 hover:bg-paper/60",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** PNG карточки как файл: имя для «Скачать» и для системного «Поделиться». */
export async function cardFile(card: RoastCardData, slug: string, n: number): Promise<File> {
  const blob = await renderCardPng(card);
  return new File([blob], `funshare-${slug}-${n}.png`, { type: "image/png" });
}

export function saveFile(file: File) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
