"use client";

import { useEffect, useState } from "react";
import type { CandidatesResponse } from "@/contracts";
import { Spinner } from "@/components/ui/Spinner";
import { cx } from "@/components/cx";
import { api, toErrorCode } from "@/lib/client/api";
import { errorLine } from "./errors";
import { StepLead, StepTitle } from "./StepTitle";

/**
 * Шаг 6, выбор: все кандидаты тарифа, выбрать ровно `selectCount`. Порядок выбора = порядок
 * в артефакте (номер в углу карточки). Когда набрано, остальные гаснут. Счётчик на тёмной
 * плашке закреплён внизу поверх карточек. Кнопки нет: набрал нужное число — через паузу
 * выбор уходит сам (снял галочку за паузу — отправка отменяется). Бэк рисует картинки
 * только по выбранным.
 */
/** Пауза между последним выбором и отправкой: успеть снять случайную галочку. */
const AUTO_SUBMIT_MS = 900;

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

  // selectCount — максимум (контракт: от 1 до него), а кандидатов бывает меньше: тогда все
  const need = data ? Math.min(data.selectCount, data.candidates.length) : 0;
  const full = picked.length >= need;

  const toggle = (punchId: string) => {
    // Ошибка отправки снимается любым переключением: человек выбрал заново — пробуем ещё раз
    setError(null);
    setPicked((prev) =>
      prev.includes(punchId)
        ? prev.filter((p) => p !== punchId)
        : prev.length < need
          ? [...prev, punchId]
          : prev,
    );
  };

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

  // Набрал ровно сколько нужно: даём секунду передумать, потом отправляем сами.
  // После ошибки сами не повторяем, иначе крутились бы в цикле
  useEffect(() => {
    if (!data || busy || error || need === 0 || picked.length !== need) return;
    const t = setTimeout(() => void submit(), AUTO_SUBMIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- submit читает актуальный picked
  }, [picked, need, data, busy, error]);

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
      <StepLead>Выбери {need || 6} самых смешных шуток</StepLead>

      <div role="group" aria-label="Шутки" className="mx-2 flex flex-col gap-3 pb-3">
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
                // Акцент на текст: без эмодзи, Unbounded крупнее, воздуха больше
                "relative flex items-start gap-4 rounded-md border-2 py-5 pr-10 pl-4 text-left font-wide text-[17px] leading-[1.3] font-bold tracking-tight transition-[translate,box-shadow,background-color,color] duration-[120ms] ease-linear",
                "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink",
                // Выбранная — уже «вдавлена»: без тени и на месте тени
                on && "translate-x-1 translate-y-1 border-ink bg-pink text-ink shadow-none",
                // Наведение — имитация нажатия, как у кнопок: тень уходит, карточка садится на её место
                !on &&
                  !off &&
                  "border-ink bg-paper text-ink shadow-offset-paper hover:translate-x-1 hover:translate-y-1 hover:shadow-none",
                off && "border-[#2b2b2b] bg-base-pattern text-[#666]",
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-extrabold",
                  on
                    ? "border-ink bg-ink text-pink"
                    : off
                      ? "border-[#444]"
                      : "border-ink bg-white",
                )}
              >
                {on && "✓"}
              </span>
              <span>{c.text}</span>
              {on && (
                <span
                  aria-hidden="true"
                  className="absolute top-2.5 right-3 font-mono text-xs font-bold"
                >
                  {index + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="sticky bottom-[max(16px,env(safe-area-inset-bottom))] z-30 mt-auto rounded-lg bg-ink px-6 pt-5 pb-6">
        <div className="mb-3.5 flex items-baseline justify-between">
          <span className="font-mono text-[22px] leading-none font-extrabold text-white">
            {picked.length} / {need}
          </span>
          <span className="flex items-center gap-2 type-body text-paper/70" aria-live="polite">
            {busy ? (
              <>
                <Spinner className="scale-70" />
                Собираем…
              </>
            ) : full ? (
              "готово"
            ) : (
              `ещё ${need - picked.length}`
            )}
          </span>
        </div>
        {/* Сегменты по числу шуток, как прогресс в шапке флоу */}
        <div className="flex gap-1" aria-hidden="true">
          {Array.from({ length: need }, (_, i) => (
            <i
              key={i}
              className={cx(
                "h-2 flex-1 rounded-[4px] transition-colors duration-200",
                i < picked.length ? "bg-white" : "bg-white/25",
              )}
            />
          ))}
        </div>
        {error && <p className="mt-2.5 border-l-2 border-red pl-3 type-body text-paper">{error}</p>}
      </div>
    </>
  );
}
