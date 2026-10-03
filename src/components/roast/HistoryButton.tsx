"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/cx";
import { IconClockHour3, IconX } from "@/components/create/icons";
import { LEVEL_NAME, TIER_NAME } from "@/components/create/labels";
import { useHistory, type HistoryEntry } from "@/lib/client/history";
import { fontVariables } from "@/styles/fonts";

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Кнопка истории в шапке лендинга (вместо бургера): часики открывают «Мои прожарки».
 * На телефоне — на весь экран, на десктопе — панель справа. Пусто — объяснение и
 * «Прожарить сейчас» внизу; есть прожарки — карточки: аккаунт, дата, тариф, степень.
 */
export function HistoryButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        aria-label="Мои прожарки"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid size-11 place-items-center rounded-sm border-2 border-ink bg-paper text-ink shadow-offset transition-[translate,box-shadow] duration-[120ms] ease-linear hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-offset-hover"
      >
        <IconClockHour3 className="size-[26px]" strokeWidth={2.75} />
      </button>
      {open && <HistoryPanel onClose={close} />}
    </>
  );
}

function HistoryPanel({ onClose }: { onClose: () => void }) {
  const history = useHistory();
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

  // Портал: шапка лежит в hero с параллаксом, а transform предка ломает position: fixed
  return createPortal(
    <div
      // Вне обёртки сайта: шрифты и тёмная тема (data-surface) задаём на корне портала
      data-surface="dark"
      className={cx(fontVariables, "fixed inset-0 z-50 flex justify-end")}
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        className="flex h-dvh w-full flex-col bg-surface text-on-surface md:w-[420px] md:border-l-2 md:border-white"
      >
        <div className="flex items-center justify-between px-[18px] pt-[max(20px,env(safe-area-inset-top))] pb-4">
          <h2
            id="history-title"
            className="font-wide text-2xl leading-none font-black tracking-tight uppercase"
          >
            Мои прожарки
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex size-10 items-center justify-center rounded-sm border-2 border-white text-paper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink"
          >
            <IconX className="size-5" strokeWidth={2.5} />
          </button>
        </div>

        {history.length ? (
          <ul className="flex flex-1 flex-col gap-3 overflow-y-auto px-[18px] pt-1 pb-[max(24px,env(safe-area-inset-bottom))]">
            {history.map((entry) => (
              <li key={entry.id}>
                <HistoryCard entry={entry} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col px-[18px] pb-[max(24px,env(safe-area-inset-bottom))]">
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="font-wide text-xl leading-tight font-black tracking-tight uppercase">
                Прожарок пока нет
              </p>
              <p className="max-w-[280px] type-body text-paper/70">
                Здесь будут все твои прожарки: чей профиль, когда, тариф и степень
              </p>
            </div>
            <Link
              href="/create"
              className="flex h-14 items-center justify-center rounded-sm border-2 border-ink bg-white font-wide font-black tracking-tight text-base text-ink uppercase shadow-offset transition-[translate,box-shadow] duration-[120ms] ease-linear hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-offset-hover"
            >
              Прожарить сейчас
            </Link>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Карточка прожарки: главное — аккаунт, под ним дата, тариф и степень. Ведёт на /g/[id]. */
function HistoryCard({ entry }: { entry: HistoryEntry }) {
  return (
    <Link
      href={`/g/${entry.id}`}
      className="flex flex-col gap-2.5 rounded-md border-2 border-ink bg-paper px-4 py-3.5 text-ink shadow-offset-paper transition-[translate,box-shadow] duration-[120ms] ease-linear hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
    >
      <span className="truncate font-wide text-lg leading-none font-black tracking-tight">
        @{entry.username}
      </span>
      <span className="type-body text-ink/60">
        {dateFmt.format(new Date(entry.createdAt))}
        {entry.mode === "friend" ? " · другу" : ""}
      </span>
      <span className="flex flex-wrap gap-1.5">
        <Chip>{TIER_NAME[entry.tier]}</Chip>
        <Chip>{LEVEL_NAME[entry.level]}</Chip>
      </span>
    </Link>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border-2 border-ink bg-white px-2 py-0.5 font-wide text-[11px] font-black tracking-tight uppercase">
      {children}
    </span>
  );
}
