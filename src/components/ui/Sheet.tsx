"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Всплывающее окно снизу: затемнение поверх экрана и ink-карточка с белой обводкой
 * в колонке флоу (480 px). Закрывается крестиком, Escape и тапом по затемнению.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 bg-base/75"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        className="relative mx-2.5 mb-[max(10px,env(safe-area-inset-bottom))] flex w-full max-w-[460px] flex-col gap-3 rounded-lg border-2 border-white bg-ink p-[18px] text-paper outline-none"
      >
        <button
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
          className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-sm border-2 border-white text-paper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        <h2 id="sheet-title" className="pr-11 type-display-m text-paper">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
