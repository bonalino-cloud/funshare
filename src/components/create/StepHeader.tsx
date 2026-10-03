import { cx } from "@/components/cx";
import { TOTAL_STEPS } from "./steps";

/**
 * Шапка флоу в одну строку: стрелка «назад» слева, отступ, прогресс из 7 сегментов и N/7.
 * Пройденные и текущий сегменты белые. Без названия шага: его говорит заголовок экрана.
 * Высота строки постоянная, чтобы контент не прыгал между шагом 1 (без стрелки) и остальными.
 */
export function StepHeader({
  step,
  onBack,
  progress = true,
}: {
  step: number;
  onBack?: () => void;
  /** На экране результата прогресса нет: флоу закончен. */
  progress?: boolean;
}) {
  // Ни прогресса, ни стрелки (экран результата): шапки нет совсем, место отдаём контенту
  if (!progress && !onBack) return null;
  return (
    <header className="mb-7 flex h-8 items-center gap-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Назад"
          className="flex size-8 shrink-0 items-center justify-center rounded-sm border-2 border-white font-wide text-lg font-black text-paper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink"
        >
          {/* Глиф сидит низко в Unbounded: поднимаем на 2 px, чтобы был по центру */}
          <span className="relative -top-0.5">‹</span>
        </button>
      )}
      {progress && (
        <div className="flex flex-1 items-center gap-3">
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
                className={cx("h-1.5 flex-1 rounded-[3px]", i < step ? "bg-white" : "bg-white/25")}
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
