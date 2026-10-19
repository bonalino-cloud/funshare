"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { GenerationStatusCode } from "@/contracts";
import { Button } from "@/components/ui/Button";
import koster from "@/components/roast/assets/level-koster.png";
import { track } from "@/lib/client/analytics";
import { isTransient } from "@/lib/client/api";
import { resetDraft } from "@/lib/client/draft";
import { recallLevel } from "@/lib/client/history";
import { useGeneration } from "@/lib/client/useGeneration";
import { CreateShell } from "./CreateShell";
import { errorLine, generationErrorLine } from "./errors";
import { LEVEL_ART } from "./levelArt";
import { Loader } from "./Loader";
import { PickPunches } from "./PickPunches";
import { ResultScreen } from "./ResultScreen";
import { StepTitle } from "./StepTitle";

/**
 * Шаги 6–7 на /g/[id]: экран зависит от статуса генерации. «Назад» нет: после запуска
 * только вперёд, а по ссылке можно вернуться в любой момент.
 */
/** Степень пишется один раз до перехода на /g/[id] и не меняется: подписываться не на что. */
const noSubscribe = () => () => {};

export function GenerationFlow({ id }: { id: string }) {
  const router = useRouter();
  const { status, error, resume, selectionSent, startedAt } = useGeneration(id);
  // Картинка лоудера = картинка выбранной степени; степень неизвестна (ссылка с другого
  // устройства) — костёр. На сервере localStorage нет, поэтому серверный снимок пустой
  const level = useSyncExternalStore(
    noSubscribe,
    () => recallLevel(id),
    () => undefined,
  );
  const art = level ? LEVEL_ART[level] : koster;

  // Генерация запущена: черновик шагов 1–5 больше не нужен
  useEffect(() => {
    resetDraft();
  }, []);

  // События по смене статуса. «Дождался» — готово стало на открытом экране, а не при входе
  // в уже готовую прожарку из истории
  const current = status?.status;
  const failReason = status?.errorCode ?? "internal";
  const seen = useRef<GenerationStatusCode | null>(null);
  useEffect(() => {
    if (!current || current === seen.current) return;
    const waited = seen.current !== null;
    seen.current = current;
    if (current === "awaiting_selection") track("selection_view");
    if (current === "failed") track("generation_failed", { reason: failReason });
    if (current === "ready") {
      if (waited) track("result_waited");
      track("result_view");
    }
  }, [current, failReason]);

  const failedLine = error
    ? generationErrorLine(error.cause)
    : status?.status === "failed"
      ? errorLine(status.errorCode ?? "internal")
      : null;
  // Связь пропала, а конвейер на сервере идёт и заказ уже создан: «Ещё раз» продолжает опрос,
  // а не уводит запускать новую прожарку
  const canResume = error !== null && isTransient(error.cause);
  const step = status?.status === "ready" ? 7 : 6;

  return (
    <CreateShell
      step={step}
      progress={status?.status !== "ready"}
      flush={status?.status === "ready"}
    >
      {failedLine ? (
        <>
          <StepTitle size="m">Не вышло</StepTitle>
          <p className="border-l-2 border-red pl-3 type-body text-paper">{failedLine}</p>
          <div className="mt-auto pt-4">
            <Button
              type="button"
              variant="inverse"
              look="display"
              arrow={false}
              className="h-16 w-full"
              onClick={
                canResume
                  ? resume
                  : () => {
                      track("again_click", { place: "failed" });
                      router.push("/create");
                    }
              }
            >
              Ещё раз
            </Button>
          </div>
        </>
      ) : !status || status.status === "queued" ? (
        <Loader image={art} phase="queued" startedAt={startedAt} />
      ) : status.status === "writing" ? (
        <Loader image={art} phase="writing" startedAt={startedAt} />
      ) : status.status === "drawing" ? (
        <Loader image={art} phase="drawing" startedAt={startedAt} />
      ) : status.status === "awaiting_selection" ? (
        <PickPunches
          id={id}
          onDone={() => {
            track("selection_submitted");
            selectionSent();
          }}
        />
      ) : (
        <ResultScreen slug={status.artifactSlug ?? ""} />
      )}
    </CreateShell>
  );
}
