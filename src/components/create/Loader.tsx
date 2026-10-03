import type { StaticImageData } from "next/image";
import { useEffect, useState } from "react";
import { ArtStage } from "./ArtStage";

/** Пул строк по фазе: меняются каждые 4 с */
export const LOADER_LINES = {
  queued: ["Разогреваем…"],
  writing: ["Пишем панчи. Стираем слишком добрые…", "Спорим сами с собой…", "Почти. Точим панчи…"],
  drawing: ["Рисуем…", "Чёртик выбирает кисточку…"],
} as const;

const SLOW_AFTER_MS = 60_000;
const SLOW_LINE = "Профиль оказался сложнее, чем казалось. Ещё чуть-чуть…";

/**
 * Экран ожидания: маскот и короткая полосатая полоса без процентов (проценты врали бы) по
 * центру экрана, под ними, в свободном месте до нижнего края, крупная строка, она меняется
 * каждые 4 с. `hint` с бэка на экран не выводим: строк на экране одна.
 */
export function Loader({
  image,
  phase,
  startedAt,
}: {
  image: StaticImageData;
  phase: keyof typeof LOADER_LINES;
  startedAt: number;
}) {
  const [tick, setTick] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1);
      setSlow(Date.now() - startedAt > SLOW_AFTER_MS);
    }, 4000);
    return () => clearInterval(t);
  }, [startedAt]);

  const pool = LOADER_LINES[phase];
  const line = slow && phase === "writing" ? SLOW_LINE : pool[tick % pool.length];

  return (
    // Три ряда: пусто / маскот с полосой ровно по центру / строка посередине нижней части, чуть выше
    <div className="grid flex-1 grid-rows-[1fr_auto_1fr] justify-items-center text-center">
      <div />
      <div className="flex w-full flex-col items-center gap-4">
        <ArtStage src={image} className="flex-none" />
        <div
          aria-hidden="true"
          className="h-4 w-[70%] max-w-[260px] overflow-hidden rounded-sm border-2 border-white bg-[#232323]"
        >
          <div className="h-full w-[42%] overflow-hidden">
            <div className="h-full w-[200%] animate-marquee bg-[repeating-linear-gradient(45deg,var(--color-pink)_0_8px,var(--color-orange)_8px_16px)] [animation-duration:1.2s]" />
          </div>
        </div>
      </div>
      <div className="flex items-center pb-[12%]">
        <p
          aria-live="polite"
          className="font-wide text-[22px] leading-none font-black tracking-tight text-paper uppercase"
        >
          {line}
        </p>
      </div>
    </div>
  );
}
