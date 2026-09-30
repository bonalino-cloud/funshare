import type { ReactNode } from "react";
import { StepHeader } from "./StepHeader";

/**
 * Каркас экрана флоу: тёмная поверхность с точечным паттерном, колонка 480 px,
 * шапка с прогрессом. Контент — flex-колонка на всю высоту, чтобы главная кнопка
 * прижималась к низу через `mt-auto` (под большим пальцем).
 */
export function CreateShell({
  step,
  onBack,
  children,
}: {
  step: number;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-surface="dark"
      className="flex flex-1 flex-col bg-surface bg-[radial-gradient(#1c1c1c_1.5px,transparent_1.6px)] bg-[size:22px_22px] text-on-surface"
    >
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-[18px] pt-4 pb-[max(18px,env(safe-area-inset-bottom))]">
        <StepHeader step={step} onBack={onBack} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
