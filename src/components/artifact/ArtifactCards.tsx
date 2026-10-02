"use client";

import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { cx } from "@/components/cx";
import { renderCardPng, type RoastCardData } from "@/lib/client/roast-card";
import { RoastCard } from "./RoastCard";

/** Сколько карточек выглядывает из-за передней. */
const PEEK = 2;
/** Сдвиг вправо (доля ширины) и уменьшение каждой следующей карточки в стопке. */
const SHIFT = 0.06;
const SHRINK = 0.06;
/** Свайп дальше этого (px) листает стопку. */
const SWIPE = 60;
/** Сколько длится улёт передней карточки, мс. */
const FLY_MS = 280;

/**
 * Стопка карточек (референс: Tips Slider Interaction, Jitu Raut): передняя ровная, задние
 * лежат под ней со сдвигом вправо и чуть ниже ростом, их края выглядывают справа.
 * Свайп влево уносит переднюю за край, и она уходит в конец стопки; вправо достаёт
 * предыдущую. Ещё стрелки клавиатуры и точки, по кругу. Ширина передней подстраивается
 * под высоту экрана, чтобы под стопкой оставались кнопки.
 */
export function ArtifactCards({
  cards,
  onIndex,
  reserve = 300,
}: {
  cards: RoastCardData[];
  onIndex?: (i: number) => void;
  /** Сколько px высоты экрана занято вокруг стопки: шапка, кнопки. */
  reserve?: number;
}) {
  const n = cards.length;
  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const [flying, setFlying] = useState(false);
  const drag = useRef<{ x: number; id: number } | null>(null);

  function go(i: number) {
    const next = ((i % n) + n) % n;
    setIndex(next);
    onIndex?.(next);
  }

  /** Вперёд: передняя улетает влево, потом встаёт в конец стопки. */
  function next() {
    if (flying || n < 2) return;
    setFlying(true);
    setTimeout(() => {
      go(index + 1);
      setFlying(false);
    }, FLY_MS);
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (n < 2 || flying) return;
    drag.current = { x: e.clientX, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x);
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (dx <= -SWIPE) next();
    else if (dx >= SWIPE) go(index - 1);
    setDx(0);
  }

  return (
    <div
      className="[container-type:inline-size] flex w-full flex-col items-center gap-3"
      style={
        {
          // Стопка шире передней на выглядывающие края: (1 + PEEK × SHIFT) × ширина
          "--card-w": `max(150px, min(calc((100cqw - 16px) / ${1 + PEEK * SHIFT}), calc((100dvh - ${reserve}px) * 9 / 16)))`,
        } as CSSProperties
      }
    >
      <div
        className="relative w-(--card-w) touch-pan-y outline-none select-none"
        // Центруем всю стопку, а не только переднюю: сдвиг на половину выглядывающих краёв
        style={{ aspectRatio: "9 / 16", translate: `${(-PEEK * SHIFT * 100) / 2}% 0` }}
        role="group"
        aria-roledescription="стопка карточек"
        aria-label={`Карточка ${index + 1} из ${n}. Листай свайпом или стрелками`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") next();
          if (e.key === "ArrowLeft") go(index - 1);
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {cards.map((card, i) => {
          // Место в стопке: 0 — передняя, 1…PEEK выглядывают, остальные спрятаны за ними
          const d = (i - index + n) % n;
          const front = d === 0;
          const depth = Math.min(d, PEEK);
          const transform =
            front && flying
              ? "translateX(-130%) rotate(-8deg)"
              : front
                ? `translateX(${dx}px) rotate(${dx / 30}deg)`
                : `translateX(${depth * SHIFT * 100}%) scale(${1 - depth * SHRINK})`;
          return (
            <div
              key={card.punchId}
              className={cx(
                "absolute inset-0 origin-right",
                !(front && dx) && "transition-[transform,opacity] duration-300 ease-out",
              )}
              style={{
                zIndex: n - d,
                opacity: d <= PEEK && !(front && flying) ? 1 : 0,
                transform,
              }}
              aria-hidden={!front}
            >
              <RoastCard
                card={card}
                priority={d <= PEEK}
                className="rounded-lg shadow-[-6px_8px_24px_rgba(0,0,0,0.45)]"
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
