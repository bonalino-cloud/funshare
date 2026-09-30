import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { StepLead, StepTitle } from "../StepTitle";

/**
 * Временный экран шага: заголовок из макета и кнопка «Дальше», чтобы каркас проходился
 * насквозь. Настоящий экран приходит в своей ветке (см. architecture/create-flow.md §5).
 */
export function Placeholder({
  title,
  accent,
  lead,
  children,
  action = "Дальше",
  onNext,
  busy,
}: {
  title: ReactNode;
  accent?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onNext?: () => void;
  busy?: boolean;
}) {
  return (
    <>
      <StepTitle accent={accent}>{title}</StepTitle>
      {lead && <StepLead>{lead}</StepLead>}
      <div className="flex flex-1 flex-col gap-3">{children}</div>
      {onNext && (
        <div className="mt-auto flex flex-col gap-2 pt-4">
          <Button type="button" className="w-full" onClick={onNext} disabled={busy}>
            {action}
          </Button>
        </div>
      )}
    </>
  );
}

/** Плашка «экран в работе»: чтобы не путать заглушку с готовым дизайном */
export function WorkInProgress({ branch }: { branch: string }) {
  return (
    <p className="rounded-md border-2 border-dashed border-paper/30 p-3 type-meta text-paper/60">
      Экран в работе: ветка <code className="font-mono">{branch}</code>. Здесь пока только каркас.
    </p>
  );
}
