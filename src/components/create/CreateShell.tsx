import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import { FlameVortex } from "@/components/roast/FlameVortex";
import { StepHeader } from "./StepHeader";

/**
 * Каркас экрана флоу: на фоне та же воронка огня, что в hero лендинга (WebGL, сама
 * подстраивается под размер экрана), в центре спокойное «окно» под контент.
 * Колонка 480 px, шапка с прогрессом. Контент — flex-колонка на всю высоту, главная
 * кнопка прижимается через `mt-auto`, но не к самому краю: снизу запас, чтобы огонь не мешал.
 */
export function CreateShell({
  step,
  onBack,
  progress,
  flush = false,
  children,
}: {
  step: number;
  progress?: boolean;
  /** Без нижнего запаса: экран сам держит кнопки у края (результат). */
  flush?: boolean;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-surface="dark"
      className="relative flex min-h-dvh flex-1 flex-col overflow-clip bg-surface text-on-surface"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <FlameVortex />
        <div className="grain absolute inset-0" />
      </div>
      <div
        className={cx(
          "relative z-10 mx-auto flex w-full max-w-[480px] flex-1 flex-col px-[18px] pt-8",
          !flush && "pb-[max(56px,env(safe-area-inset-bottom))]",
        )}
      >
        <StepHeader step={step} onBack={onBack} progress={progress} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
