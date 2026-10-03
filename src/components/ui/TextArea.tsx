"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cx } from "@/components/cx";

/**
 * Многострочное поле в языке LinkInput: paper, ink-обводка, radius.s, offset-тень.
 * Растёт по содержимому. Ошибка — красная обводка и строка под полем человеческим текстом.
 */
export function TextArea({
  error,
  size = "md",
  className,
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: string;
  /** lg — поле примерно на треть крупнее: факты на шаге 2 */
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Высота по содержимому: сбрасываем и берём scrollHeight
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <label className={cx("block", className)}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        aria-invalid={error ? true : undefined}
        className={cx(
          "block w-full resize-none rounded-sm border-2 border-ink bg-paper font-semibold text-ink shadow-offset-paper outline-none placeholder:text-ink/45",
          size === "lg" ? "px-5 py-[18px] text-[19px] leading-[1.35]" : "px-4 py-3.5 type-body",
          "focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-pink",
          error && "outline-3 outline-offset-4 outline-red",
          props.disabled && "opacity-70",
        )}
        {...props}
      />
      {error && (
        <span role="alert" className="mt-3 block border-l-2 border-red pl-3 type-body text-paper">
          {error}
        </span>
      )}
    </label>
  );
}
