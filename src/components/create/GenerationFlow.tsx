"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import impChef from "@/components/roast/assets/imp-chef.png";
import koster from "@/components/roast/assets/level-koster.png";
import { resetDraft } from "@/lib/client/draft";
import { useGeneration } from "@/lib/client/useGeneration";
import { CreateShell } from "./CreateShell";
import { errorLine } from "./errors";
import { Loader } from "./Loader";
import { PickPunches } from "./PickPunches";
import { ResultScreen } from "./ResultScreen";
import { StepTitle } from "./StepTitle";

/**
 * Шаги 6–7 на /g/[id]: экран зависит от статуса генерации. «Назад» нет: после запуска
 * только вперёд, а по ссылке можно вернуться в любой момент.
 */
export function GenerationFlow({ id }: { id: string }) {
  const router = useRouter();
  const { status, error, resume, startedAt } = useGeneration(id);

  // Генерация запущена: черновик шагов 1–5 больше не нужен
  useEffect(() => {
    resetDraft();
  }, []);

  const failed = error ?? (status?.status === "failed" ? status.errorCode : null);
  const step = status?.status === "ready" ? 7 : 6;

  return (
    <CreateShell
      step={step}
      progress={status?.status !== "ready"}
      flush={status?.status === "ready"}
    >
      {failed ? (
        <>
          <StepTitle size="m">Не вышло</StepTitle>
          <p className="border-l-2 border-red pl-3 type-body text-paper">{errorLine(failed)}</p>
          <div className="mt-auto pt-4">
            <Button
              type="button"
              variant="inverse"
              look="display"
              arrow={false}
              className="h-16 w-full"
              onClick={() => router.push("/create")}
            >
              Ещё раз
            </Button>
          </div>
        </>
      ) : !status || status.status === "queued" ? (
        <Loader image={koster} phase="queued" startedAt={startedAt} />
      ) : status.status === "writing" ? (
        <Loader image={koster} phase="writing" hint={status.hint} startedAt={startedAt} />
      ) : status.status === "drawing" ? (
        <Loader image={impChef} phase="drawing" hint={status.hint} startedAt={startedAt} />
      ) : status.status === "awaiting_selection" ? (
        <PickPunches id={id} onDone={resume} />
      ) : (
        <ResultScreen slug={status.artifactSlug ?? ""} />
      )}
    </CreateShell>
  );
}
