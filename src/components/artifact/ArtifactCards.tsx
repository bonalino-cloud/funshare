"use client";

import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { cx } from "@/components/cx";
import { renderCardPng, type RoastCardData } from "@/lib/client/roast-card";
import { RoastCard } from "./RoastCard";

/** Поворот карточек, которые выглядывают из-за передней: следующая и та, что за ней. */
const BEHIND = [-5, 5] as const;
/** Свайп дальше этого (px) листает колоду. */
const SWIPE = 60;

/**
 * Колода карточек: передняя ровно по центру, за ней краями выглядывают следующие,
 * повёрнутые на −5° и +5°. Листается свайпом, стрелками и точками, по кругу.
 * Ширина передней подстраивается под высоту экрана, чтобы под колодой оставались кнопки.
 */
export function ArtifactCards({
  cards,
  onIndex,
  reserve = 300,
}: {
  cards: RoastCardData[];
  onIndex?: (i: number) => void;
  /** Сколько px высоты экрана занято вокруг колоды: шапка, заголовок, кнопки. */
  reserve?: number;
}) {
  const n = cards.length;
  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; id: number } | null>(null);

  function go(i: number) {
    const next = ((i % n) + n) % n;
    setIndex(next);
    onIndex?.(next);
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (n < 2) return;
    drag.current = { x: e.clientX, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x);
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (dx <= -SWIPE) go(index + 1);
    else if (dx >= SWIPE) go(index - 1);
    setDx(0);
  }

  return (
    <div
      className="[container-type:inline-size] flex w-full flex-col items-center gap-3"
      style={
        {
          // Запас по бокам под повёрнутые края задних карточек
          "--card-w": `max(150px, min(calc(100cqw - 48px), calc((100dvh - ${reserve}px) * 9 / 16)))`,
        } as CSSProperties
      }
    >
      <div
        className="relative w-(--card-w) touch-pan-y outline-none select-none"
        style={{ aspectRatio: "9 / 16" }}
        role="group"
        aria-roledescription="колода карточек"
        aria-label={`Карточка ${index + 1} из ${n}. Листай свайпом или стрелками`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(index + 1);
          if (e.key === "ArrowLeft") go(index - 1);
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {cards.map((card, i) => {
          // Место в колоде: 0 — передняя, 1 и 2 — выглядывают, остальные спрятаны сзади
          const d = (i - index + n) % n;
          const front = d === 0;
          const rot = front ? dx / 18 : (BEHIND[d - 1] ?? 0);
          return (
            <div
              key={card.punchId}
              className={cx(
                "absolute inset-0 origin-bottom",
                !(front && dx) && "transition-[transform,opacity] duration-300 ease-out",
              )}
              style={{
                zIndex: n - d,
                opacity: d <= BEHIND.length ? 1 : 0,
                transform: `translateX(${front ? dx : 0}px) rotate(${rot}deg) scale(${front ? 1 : 0.97})`,
              }}
              aria-hidden={!front}
            >
              <RoastCard
                card={card}
                priority={d <= BEHIND.length}
                className="rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
              />
            </div>
          );
        })}
      </div>
      {n > 1 && (
        <div className="relative z-10 flex gap-1" role="tablist" aria-label="Выбор карточки">
          {cards.map((card, i) => (
            <button
              key={card.punchId}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Карточка ${i + 1}`}
              onClick={() => go(i)}
              // Точка маленькая, а зона нажатия 16 px: псевдоэлемент шире самой точки
              className={cx(
                "relative h-1 rounded-full transition-all duration-200 before:absolute before:-inset-1.5",
                i === index ? "w-3 bg-paper" : "w-1 bg-paper/35 hover:bg-paper/60",
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
