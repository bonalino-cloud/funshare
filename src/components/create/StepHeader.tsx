import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import { TOTAL_STEPS } from "./steps";

/**
 * Шапка флоу: стрелка «назад» отдельной строкой по центру, под ней прогресс из 7 сегментов и N/7.
 * Сегмент текущего шага закрашен полностью. Без названия шага: его говорит заголовок экрана.
 */
export function StepHeader({
  step,
  onBack,
  action,
  progress = true,
}: {
  step: number;
  /** На экране результата прогресса нет: флоу закончен. */
  progress?: boolean;
  onBack?: () => void;
  /** Вместо стрелки «назад»: например, «Ещё раз» на экране результата */
  action?: ReactNode;
}) {
  return (
    <header className={cx("flex flex-col gap-5", progress ? "mb-7" : "mb-3")}>
      <div className="flex h-8 items-center justify-center">
        {action ??
          (onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Назад"
              className="flex size-8 shrink-0 items-center justify-center rounded-sm border-2 border-white font-wide text-lg font-black text-paper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink"
            >
              {/* Глиф сидит низко в Unbounded: поднимаем на 2 px, чтобы был по центру */}
              <span className="relative -top-0.5">‹</span>
            </button>
          ) : (
            <span aria-hidden="true" className="size-8 shrink-0" />
          ))}
      </div>
      {progress && (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={step}
            aria-label={`Шаг ${step} из ${TOTAL_STEPS}`}
            className="flex flex-1 gap-1"
          >
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <i
                key={i}
                className={cx("h-1.5 flex-1 rounded-[3px]", i < step ? "bg-pink" : "bg-[#2b2b2b]")}
              />
            ))}
          </div>
          <span className="min-w-[30px] shrink-0 text-right font-mono text-[13px] font-bold text-paper">
            {step}/{TOTAL_STEPS}
          </span>
        </div>
      )}
    </header>
  );
}
