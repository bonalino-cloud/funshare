"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconDownload, IconX } from "@/components/create/icons";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/cx";
import { renderCardPng, type RoastCardData } from "@/lib/client/roast-card";
import { RoastCard } from "./RoastCard";

/** Сколько карточек выглядывает из-за передней. */
const PEEK = 2;
/** Сдвиг вправо (доля ширины) и уменьшение каждой следующей карточки в стопке. */
const SHIFT = 0.06;
const SHRINK = 0.06;
/** Затемнение по глубине: передняя, первая задняя, вторая задняя. */
const DIM = [0, 0.3, 0.55] as const;
/** Свайп дальше этого (px) листает стопку. */
const SWIPE = 60;
/** Сдвиг пальца меньше этого (px) — тап: открываем карточку на весь экран. */
const TAP = 6;
/** Сколько длится улёт передней карточки, мс. */
const FLY_MS = 280;

/**
 * Стопка карточек (референс: Tips Slider Interaction, Jitu Raut): передняя ровная, задние
 * лежат под ней со сдвигом вправо и чуть ниже ростом, их края выглядывают справа.
 * Свайп влево уносит переднюю за край, и она уходит в конец стопки; вправо достаёт
 * предыдущую. Ещё стрелки клавиатуры и точки, по кругу. Тап (или Enter) открывает
 * переднюю на весь экран с кнопкой «Скачать». Ширина передней подстраивается под высоту
 * экрана, чтобы под стопкой оставались кнопки.
 */
export function ArtifactCards({
  cards,
  slug,
  onIndex,
  reserve = 300,
}: {
  cards: RoastCardData[];
  /** Для имени скачанного файла. */
  slug: string;
  onIndex?: (i: number) => void;
  /** Сколько px высоты экрана занято вокруг стопки: шапка, кнопки. */
  reserve?: number;
}) {
  const n = cards.length;
  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const [flying, setFlying] = useState(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
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
    if (flying) return;
    drag.current = { x: e.clientX, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x);
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== e.pointerId) return;
    const moved = e.clientX - drag.current.x;
    drag.current = null;
    setDx(0);
    if (e.type === "pointercancel") return;
    if (Math.abs(moved) < TAP) setOpen(true);
    else if (n < 2) return;
    else if (moved <= -SWIPE) next();
    else if (moved >= SWIPE) go(index - 1);
  }

  return (
    <div
      className="[container-type:inline-size] flex w-full flex-col items-center gap-5"
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
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
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
              <RoastCard card={card} priority={d <= PEEK} className="rounded-lg" />
              {/* Задние темнее с глубиной: передняя читается первой. Слоем сверху, а не в самой
                  карточке, чтобы затемнение не попало в PNG */}
              <div
                aria-hidden="true"
                className="bg-black pointer-events-none absolute inset-0 rounded-lg transition-opacity duration-300 ease-out"
                style={{ backgroundColor: "#000", opacity: DIM[depth] ?? 0 }}
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
      {open && cards[index] && (
        <CardViewer card={cards[index]} slug={slug} n={index + 1} onClose={close} />
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

/**
 * Карточка на весь экран поверх затемнения, внизу «Скачать» — PNG только этой карточки.
 * Закрывается крестиком, тапом мимо карточки и Esc. Через портал в body: у колоды
 * container-type, и fixed внутри неё встал бы относительно колоды, а не экрана.
 */
function CardViewer({
  card,
  slug,
  n,
  onClose,
}: {
  card: RoastCardData;
  slug: string;
  n: number;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      saveFile(await cardFile(card, slug, n));
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Карточка ${n}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]"
      // Размытие прячет кнопки страницы под просмотром: остаётся ровная тёмная подложка
      style={{ backgroundColor: "rgba(0,0,0,0.9)", backdropFilter: "blur(14px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Закрыть"
        className="absolute top-[max(16px,env(safe-area-inset-top))] right-4 flex size-10 items-center justify-center rounded-sm border-2 border-white text-paper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink"
      >
        <IconX className="size-5" strokeWidth={2.5} />
      </button>
      <div className="w-[min(100%,calc((100dvh-140px)*9/16))]">
        <RoastCard card={card} priority className="rounded-lg" />
      </div>
      <Button
        type="button"
        variant="inverse"
        look="display"
        arrow={false}
        className="h-14 w-[min(100%,calc((100dvh-140px)*9/16))]"
        icon={
          done ? (
            <IconCheck className="size-5" strokeWidth={2.75} />
          ) : (
            <IconDownload className="size-5" strokeWidth={2.75} />
          )
        }
        onClick={save}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {done ? "Сохранено" : "Скачать"}
      </Button>
    </div>,
    document.body,
  );
}
