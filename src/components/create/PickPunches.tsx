"use client";

import { useEffect, useState } from "react";
import type { CandidatesResponse } from "@/contracts";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/cx";
import { api, toErrorCode } from "@/lib/client/api";
import { errorLine } from "./errors";
import { StepLead, StepTitle } from "./StepTitle";

/**
 * Шаг 6, выбор: все кандидаты тарифа, выбрать ровно `selectCount`. Порядок выбора = порядок
 * в артефакте (номер в углу карточки). Когда набрано, остальные гаснут. Панель со счётчиком
 * и кнопкой закреплена внизу. Отправка выбора → бэк рисует картинки только по выбранным.
 */
export function PickPunches({ id, onDone }: { id: string; onDone: () => void }) {
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getCandidates(id)
      .then((c) => alive && setData(c))
      .catch((e: unknown) => alive && setError(errorLine(toErrorCode(e))));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const need = data?.selectCount ?? 0;
  const full = picked.length >= need;

  const toggle = (punchId: string) =>
    setPicked((prev) =>
      prev.includes(punchId)
        ? prev.filter((p) => p !== punchId)
        : prev.length < need
          ? [...prev, punchId]
          : prev,
    );

  async function submit() {
    if (!data || picked.length !== need) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitSelection(id, { punchIds: picked });
      onDone();
    } catch (e) {
      setError(errorLine(toErrorCode(e)));
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <>
        <StepTitle size="m">Не открылось</StepTitle>
        <p className="border-l-2 border-red pl-3 type-body text-paper">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
          className="mt-3 self-start type-label text-pink underline underline-offset-4"
        >
          Ещё раз
        </button>
      </>
    );
  }

  return (
    <>
      <StepTitle accent={data ? `из ${data.candidates.length}` : undefined} size="m">
        Выбери {need || "…"}
      </StepTitle>
      <StepLead>Эти пойдут в артефакт. Остальные останутся у нас</StepLead>

      <div role="group" aria-label="Шутки" className="flex flex-col gap-2 pb-3">
        {data?.candidates.map((c) => {
          const index = picked.indexOf(c.id);
          const on = index >= 0;
          const off = !on && full;
          return (
            <button
              key={c.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={off || busy}
              onClick={() => toggle(c.id)}
              className={cx(
                "relative flex items-start gap-3 rounded-md border-2 py-3 pr-9 pl-3 text-left type-body font-semibold transition-colors duration-[120ms]",
                "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink",
                on && "border-ink bg-pink text-ink shadow-offset-paper",
                !on && !off && "border-ink bg-paper text-ink shadow-offset-paper",
                off && "border-[#2b2b2b] bg-base-pattern text-[#666]",
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "mt-px flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-extrabold",
                  on
                    ? "border-ink bg-ink text-pink"
                    : off
                      ? "border-[#444]"
                      : "border-ink bg-white",
                )}
              >
                {on && "✓"}
              </span>
              <span>
                {c.emoji} {c.text}
              </span>
              {on && (
                <span
                  aria-hidden="true"
                  className="absolute top-2 right-2.5 font-mono text-xs font-bold"
                >
                  {index + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="sticky bottom-0 -mx-[18px] mt-auto border-t-2 border-white bg-ink px-[18px] pt-3 pb-[max(56px,env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[22px] leading-none font-extrabold text-yellow">
            {picked.length} / {need}
          </span>
          <span className="type-body text-paper/70">
            {full ? "готово" : `ещё ${need - picked.length}`}
          </span>
        </div>
        <div className="mb-2.5 h-2 overflow-hidden rounded-[4px] bg-[#2b2b2b]" aria-hidden="true">
          <div
            className="h-full bg-pink transition-[width] duration-200"
            style={{ width: need ? `${(picked.length / need) * 100}%` : 0 }}
          />
        </div>
        {error && <p className="mb-2 border-l-2 border-red pl-3 type-body text-paper">{error}</p>}
        <Button
          type="button"
          variant="inverse"
          look="display"
          arrow={false}
          className="h-16 w-full"
          disabled={!data || picked.length !== need || busy}
          onClick={submit}
          aria-busy={busy || undefined}
        >
          {busy ? "Собираем…" : "Собрать артефакт"}
        </Button>
      </div>
    </>
  );
}
