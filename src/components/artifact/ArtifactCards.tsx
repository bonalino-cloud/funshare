"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
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
  shareText,
  onIndex,
  reserve = 300,
}: {
  cards: RoastCardData[];
  /** Для имени скачанного файла и ссылки при «Поделиться». */
  slug: string;
  /** Текст к «Поделиться» в полноэкранном просмотре. */
  shareText?: string;
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
        <CardViewer
          card={cards[index]}
          slug={slug}
          shareText={shareText}
          n={index + 1}
          total={n}
          onPrev={() => go(index - 1)}
          onNext={() => go(index + 1)}
          onClose={close}
        />
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
 * Карточка на всю высоту экрана без скругления (как в PNG), поверх неё внизу рядом
 * «Скачать» и «Поделиться» — обе про эту карточку. Свайп влево/вправо и стрелки листают (колода под просмотром
 * листается вместе с ним), тап по карточке возвращает к колоде; ещё крестик, тап мимо и Esc.
 * Через портал в body: у колоды container-type, и fixed внутри неё встал бы
 * относительно колоды, а не экрана.
 */
function CardViewer({
  card,
  slug,
  shareText,
  n,
  total,
  onPrev,
  onNext,
  onClose,
}: {
  card: RoastCardData;
  slug: string;
  shareText?: string;
  n: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"save" | "share" | null>(null);
  const [flash, setFlash] = useState<"saved" | "copied" | null>(null);
  const [dx, setDx] = useState(0);
  /** PNG по id шутки, готовим заранее: на iOS долгое ожидание перед share() ломает жест. */
  const files = useRef(new Map<string, Promise<File>>());

  function fileNow(): Promise<File> {
    let f = files.current.get(card.punchId);
    if (!f) {
      f = cardFile(card, slug, n);
      f.catch(() => files.current.delete(card.punchId));
      files.current.set(card.punchId, f);
    }
    return f;
  }

  useEffect(() => {
    fileNow().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- готовим файл, когда сменилась карточка
  }, [card.punchId]);

  function show(f: "saved" | "copied") {
    setFlash(f);
    setTimeout(() => setFlash(null), 2000);
  }
  const drag = useRef<{ x: number; id: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Стрелки видят свежие колбэки, а подписка на keydown не пересоздаётся на каждый рендер
  const onArrow = useEffectEvent((key: string) => {
    if (key === "ArrowRight") onNext();
    if (key === "ArrowLeft") onPrev();
  });

  function down(e: PointerEvent<HTMLDivElement>) {
    // Нажатия на «Скачать» и «×» — это кнопки, а не свайп и не тап по карточке
    if ((e.target as HTMLElement).closest("button")) return;
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
    if (Math.abs(moved) < TAP) onClose();
    else if (total < 2) return;
    else if (moved <= -SWIPE) onNext();
    else if (moved >= SWIPE) onPrev();
  }

  useEffect(() => {
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      onArrow(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function save() {
    if (busy) return;
    setBusy("save");
    try {
      saveFile(await fileNow());
      show("saved");
    } finally {
      setBusy(null);
    }
  }

  /** PNG этой карточки + ссылка; без файлов — только ссылка; без системного меню — копируем ссылку. */
  async function share() {
    if (busy) return;
    setBusy("share");
    const url = `${window.location.origin}/a/${slug}`;
    try {
      const file = await fileNow().catch(() => null);
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText, url });
      } else if (navigator.share) {
        await navigator.share({ title: "Прожарка", text: shareText, url });
      } else {
        await navigator.clipboard.writeText(url);
        show("copied");
      }
    } catch {
      // закрыли системное меню или нет доступа к буферу: ничего не делаем
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Карточка ${n} из ${total}. Свайп листает, тап возвращает к карточкам`}
      className="fixed inset-0 z-50 flex items-center justify-center"
      // Размытие прячет страницу под просмотром там, куда карточка не дотягивается
      style={{ backgroundColor: "rgba(0,0,0,0.9)", backdropFilter: "blur(14px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Карточка во всю высоту экрана (на узком — во всю ширину), без скругления, как в PNG.
          Кнопки лежат поверх неё */}
      <div
        className={cx(
          "relative w-[min(100vw,calc(100dvh*9/16))] touch-pan-y select-none",
          !dx && "transition-transform duration-200 ease-out",
        )}
        style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <RoastCard card={card} priority />
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute top-[max(16px,env(safe-area-inset-top))] right-4 flex size-10 items-center justify-center rounded-sm border-2 border-ink bg-white text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink"
        >
          <IconX className="size-5" strokeWidth={2.5} />
        </button>
        {/* Две кнопки рядом поверх карточки, отступ 24 по краям */}
        <div className="absolute inset-x-6 bottom-[max(24px,env(safe-area-inset-bottom))] flex gap-2">
          <Button
            type="button"
            variant="inverse"
            look="display"
            arrow={false}
            className="h-14 min-w-0 flex-1 gap-2 px-3 text-sm!"
            icon={
              flash === "saved" ? (
                <IconCheck className="size-5" strokeWidth={2.75} />
              ) : (
                <IconDownload className="size-5" strokeWidth={2.75} />
              )
            }
            onClick={save}
            disabled={busy !== null}
            aria-busy={busy === "save" || undefined}
          >
            {flash === "saved" ? "Сохранено" : "Скачать"}
          </Button>
          <Button
            type="button"
            variant="inverse"
            look="display"
            arrow={false}
            className="h-14 min-w-0 flex-1 px-3 text-sm!"
            onClick={share}
            disabled={busy !== null}
            aria-busy={busy === "share" || undefined}
          >
            {flash === "copied" ? "Ссылка скопирована" : "Поделиться"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
