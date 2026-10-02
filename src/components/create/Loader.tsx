import type { StaticImageData } from "next/image";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
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
 * Экран ожидания: маскот, короткая полосатая полоса без процентов (проценты врали бы),
 * крупная строка меняется каждые 4 с. `hint` с бэка — внизу экрана мелким оранжевым
 * Unbounded с лоудером-ромбами, как на кнопках.
 */
export function Loader({
  image,
  phase,
  hint,
  startedAt,
}: {
  image: StaticImageData;
  phase: keyof typeof LOADER_LINES;
  hint?: string;
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
    <div className="flex flex-1 flex-col" aria-live="polite">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <ArtStage src={image} className="flex-none" />
        <div
          aria-hidden="true"
          className="h-4 w-[70%] max-w-[260px] overflow-hidden rounded-sm border-2 border-white bg-[#232323]"
        >
          <div className="h-full w-[42%] overflow-hidden">
            <div className="h-full w-[200%] animate-marquee bg-[repeating-linear-gradient(45deg,var(--color-pink)_0_8px,var(--color-orange)_8px_16px)] [animation-duration:1.2s]" />
          </div>
        </div>
        <p className="font-wide text-[22px] leading-none font-black tracking-tight text-paper uppercase">
          {line}
        </p>
      </div>
      {hint && (
        <p className="flex items-center justify-center gap-2 pt-4 font-wide text-[clamp(0.75rem,0.5rem+0.6vw,1rem)] leading-none font-black tracking-tight text-orange uppercase">
          {/* Ромбы мельче, чем в кнопках: подпись здесь 12–16 px */}
          <Spinner className="scale-70" />
          {hint}
        </p>
      )}
    </div>
  );
}
