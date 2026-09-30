import type { StaticImageData } from "next/image";
import { useEffect, useState } from "react";
import { ArtStage } from "./ArtStage";

/** Пул строк по фазе; сервер может прислать свою через `hint`, тогда она главнее */
export const LOADER_LINES = {
  queued: ["Разогреваем…"],
  writing: ["Пишем панчи. Стираем слишком добрые…", "Спорим сами с собой…", "Почти. Точим панчи…"],
  drawing: ["Рисуем…", "Чёртик выбирает кисточку…"],
} as const;

const SLOW_AFTER_MS = 60_000;
const SLOW_LINE = "Профиль оказался сложнее, чем казалось. Ещё чуть-чуть…";

/**
 * Экран ожидания: маскот парит над свечением, полосатая полоса без процентов
 * (проценты врали бы), крупная строка меняется каждые 4 с, `hint` с бэка — жёлтым моно.
 */
export function Loader({
  image,
  phase,
  hint,
  startedAt,
  note,
}: {
  image: StaticImageData;
  phase: keyof typeof LOADER_LINES;
  hint?: string;
  startedAt: number;
  note?: string;
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
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
      aria-live="polite"
    >
      <ArtStage src={image} className="flex-none" />
      <div
        aria-hidden="true"
        className="h-4 w-full overflow-hidden rounded-sm border-2 border-white bg-[#232323]"
      >
        <div className="h-full w-[42%] overflow-hidden">
          <div className="h-full w-[200%] animate-marquee bg-[repeating-linear-gradient(45deg,var(--color-pink)_0_8px,var(--color-orange)_8px_16px)] [animation-duration:1.2s]" />
        </div>
      </div>
      <p className="font-wide text-[22px] leading-none font-black tracking-tight text-paper uppercase">
        {line}
      </p>
      {hint && <p className="type-mono text-yellow">{hint}</p>}
      {note && <p className="max-w-[260px] type-meta text-paper/55">{note}</p>}
    </div>
  );
}
