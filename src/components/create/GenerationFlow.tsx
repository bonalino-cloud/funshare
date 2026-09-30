"use client";

import { useEffect, useState } from "react";
import type { GenerationStatus } from "@/contracts";
import { api, toErrorCode } from "@/lib/client/api";
import { resetDraft } from "@/lib/client/draft";
import { pollUntil } from "@/lib/client/poll";
import { CreateShell } from "./CreateShell";
import { StepLead, StepTitle } from "./StepTitle";
import { WorkInProgress } from "./steps/Placeholder";

/** Человеческие строки по статусу; коды только в логи (CLAUDE.md). */
const LINES: Record<GenerationStatus["status"], string> = {
  queued: "Разогреваем…",
  writing: "Пишем панчи…",
  awaiting_selection: "Панчи готовы. Выбирай",
  drawing: "Рисуем…",
  ready: "Готово. Смотри, что вышло",
  failed: "У нас что-то сломалось. Уже чиним, попробуй через пару минут",
};

/**
 * Шаги 6–7 на /g/[id]: поллинг статуса раз в 2 с, экран зависит от статуса.
 * Здесь каркас; лоудер, выбор шуток и результат приходят в своих ветках.
 */
export function GenerationFlow({ id }: { id: string }) {
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Генерация запущена: черновик шагов 1–5 больше не нужен
  useEffect(() => {
    resetDraft();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    pollUntil(
      () => api.getGeneration(id),
      (s) => s.status === "ready" || s.status === "failed",
      {
        signal: ac.signal,
        onTick: setStatus,
      },
    ).catch((e: unknown) => {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(toErrorCode(e));
    });
    return () => ac.abort();
  }, [id]);

  const step = status?.status === "ready" ? 7 : 6;
  const line = error ? LINES.failed : status ? LINES[status.status] : "Открываем…";

  return (
    <CreateShell step={step}>
      <StepTitle size="m">{line}</StepTitle>
      {status?.hint && <StepLead>{status.hint}</StepLead>}
      <WorkInProgress branch="fe/p1-generation-loader, fe/p1-pick-punches" />
      <p className="mt-3 font-mono text-[13px] text-paper/50">
        {id} · {status?.status ?? "…"}
        {status?.artifactSlug && ` · /a/${status.artifactSlug}`}
      </p>
    </CreateShell>
  );
}
