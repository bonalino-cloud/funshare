import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/cx";

/**
 * Главное поле сервиса — ссылка на Instagram. paper, ink-обводка, radius.s, offset-тень.
 * Ошибку показываем человеческим текстом под полем, не кодом: что случилось + что делать.
 * Поле живёт на тёмных поверхностях, поэтому текст ошибки paper с красной чертой слева.
 */
export function LinkInput({
  error,
  before = "@",
  tall = false,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  /** Что стоит перед полем: «@» для ника, null — ничего (промокод) */
  before?: ReactNode | null;
  /** Поле выше и крупнее: шаги флоу. (`size` занят html-атрибутом input) */
  tall?: boolean;
}) {
  return (
    <label className={cx("block", className)}>
      <span
        className={cx(
          tall ? "h-16 px-5" : "h-14 px-4",
          "flex items-center gap-2 rounded-sm border-2 border-ink bg-paper text-ink shadow-offset focus-within:outline-3 focus-within:outline-offset-4 focus-within:outline-pink",
          error && "outline-3 outline-offset-4 outline-red",
          props.disabled && "opacity-70",
        )}
      >
        {before !== null && (
          <span className="font-wide text-xl font-extrabold text-ink">{before}</span>
        )}
        <input
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cx(
            "w-full bg-transparent font-semibold outline-none placeholder:text-ink/40",
            tall ? "text-[17px]" : "type-body",
          )}
          aria-invalid={error ? true : undefined}
          {...props}
        />
      </span>
      {error && (
        <span role="alert" className="mt-3 block border-l-2 border-red pl-3 type-body text-paper">
          {error}
        </span>
      )}
    </label>
  );
}
