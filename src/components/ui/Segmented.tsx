import { cx } from "@/components/cx";

/**
 * Переключатель из 2–3 коротких симметричных слов («Себя / Друга»).
 * Активный — pink с ink-обводкой и offset-тенью, остальные — прозрачные с белой обводкой.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Подпись для скринридера */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("flex gap-2", disabled && "opacity-50", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-12 flex-1 rounded-sm border-2 px-2 type-label transition-[transform,box-shadow,background-color] duration-[120ms] ease-linear",
              "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink",
              on
                ? "border-ink bg-pink text-ink shadow-offset-paper"
                : "border-white bg-transparent text-paper",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
