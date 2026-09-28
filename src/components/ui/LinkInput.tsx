import type { InputHTMLAttributes } from "react";
import { cx } from "@/components/cx";

/**
 * Главное поле сервиса — ссылка на Instagram. Крупное, кремовое, с префиксом @.
 * Ошибку показываем человеческим текстом под полем, не кодом.
 */
export function LinkInput({
  error,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="flex min-h-16 items-center gap-2 rounded-chip bg-paper px-6 text-ink shadow-pop ring-2 ring-ink focus-within:ring-4 focus-within:ring-sun">
        <span className="font-display text-2xl font-extrabold text-ink/40">@</span>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full bg-transparent font-display text-xl font-bold tracking-tight outline-none placeholder:text-ink/35"
          aria-invalid={error ? true : undefined}
          {...props}
        />
      </span>
      {error && (
        <span className="mt-3 block pl-6 type-eyebrow text-tomato normal-case">{error}</span>
      )}
    </label>
  );
}
