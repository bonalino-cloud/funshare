import type { CSSProperties } from "react";
import { cx } from "@/components/cx";

/**
 * Пламя из частиц (техника codepen artyom-ivanov/MoxENg): круги orange поднимаются, сжимаются и желтеют,
 * «обратные» круги цвета фона вырезают из пятна языки, gooey-фильтр склеивает всё в один огонь.
 *
 * Размер и место задаёт className контейнера (absolute, высота = высота огня).
 * trigger="hover" — огонь появляется, когда курсор над ближайшим предком с классом group/flames.
 * cut — цвет вырезов = цвет фона под огнём (CSS-значение). null — без вырезов (огонь поверх пёстрого фона).
 * from / to — цвет пламени у основания и на кончиках: подбирается под фон, чтобы огонь читался (flameOn).
 */

const FLAMES = 40;
const CUTS = 12;

// Детерминированный «рандом», чтобы разметка совпадала на сервере и клиенте
const rnd = (i: number, n: number) =>
  (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1;

const flames = Array.from({ length: FLAMES }, (_, i) => ({
  left: Math.round(6 + rnd(i, 1) * 88),
  sink: Math.round(14 + rnd(i, 2) * 26),
  // Равномерно по циклу 1.2 с, как i*0.14s в пене
  delay: Math.round(((i * 0.37) % 1.2) * 100) / 100,
}));

const cuts = Array.from({ length: CUTS }, (_, i) => ({
  side: i < CUTS / 2 ? ("left" as const) : ("right" as const),
  // Вырезы по всей ширине: половина летит вправо, половина влево
  offset: Math.round(((i % (CUTS / 2)) / (CUTS / 2)) * 44 + rnd(i, 3) * 8),
  sink: Math.round(10 + rnd(i, 4) * 22),
  delay: Math.round(((i * 0.53) % 1.2) * 100) / 100,
}));

export function Flames({
  className,
  particle = "lg",
  trigger = "always",
  cut = "var(--eye, var(--surface))",
  from,
  to,
}: {
  className?: string;
  /** lg — 56→80 px частицы (главная кнопка), sm — 40 px (карточки, маленькая кнопка) */
  particle?: "lg" | "sm";
  trigger?: "always" | "hover";
  cut?: string | null;
  from?: string;
  to?: string;
}) {
  const size = particle === "lg" ? "-ml-7 size-14 md:-ml-10 md:size-20" : "-ml-5 size-10";
  const cutSize = particle === "lg" ? "size-14 md:size-20" : "size-10";
  return (
    <span
      aria-hidden="true"
      className={cx(
        "pointer-events-none absolute origin-bottom overflow-hidden transition-transform duration-300 ease-[var(--ease-poster)]",
        trigger === "hover" &&
          "scale-y-0 group-focus-within/flames:scale-y-100 group-hover/flames:scale-y-100",
        className,
      )}
      style={{ "--flame-from": from, "--flame-to": to } as CSSProperties}
    >
      <svg aria-hidden="true" className="absolute size-0">
        <filter id="fire-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
          <feColorMatrix
            in="blur"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
            result="goo"
          />
          <feBlend in="SourceGraphic" in2="goo" />
        </filter>
      </svg>
      <span className="absolute inset-0 [filter:url(#fire-goo)]">
        <span className="absolute inset-x-[4%] bottom-0 h-10 rounded-full bg-[var(--flame-from,var(--color-orange))]" />
        {flames.map((f, i) => (
          <span
            key={i}
            className={cx(
              "absolute bottom-0 [animation:firecircle_1.2s_cubic-bezier(0.5,0.07,0.64,1)_infinite] rounded-full bg-[var(--flame-from,var(--color-orange))] group-hover/fire:[animation-duration:0.8s]",
              size,
            )}
            style={{ left: `${f.left}%`, marginBottom: -f.sink, animationDelay: `${f.delay}s` }}
          />
        ))}
      </span>
      {cut &&
        cuts.map((c, i) => (
          <span
            key={i}
            className={cx(
              "absolute bottom-0 rounded-full",
              cutSize,
              c.side === "left"
                ? "[animation:firecut-left_1.2s_cubic-bezier(0.5,0.07,0.64,1)_infinite]"
                : "[animation:firecut-right_1.2s_cubic-bezier(0.5,0.07,0.64,1)_infinite]",
            )}
            style={{
              [c.side]: `${c.offset - 6}%`,
              marginBottom: -c.sink,
              animationDelay: `${c.delay}s`,
              background: cut,
            }}
          />
        ))}
    </span>
  );
}

/** Пара цветов пламени под фон карточки: огонь должен контрастировать с заливкой */
export function flameOn(tone: string): { from: string; to: string; cut: string } {
  const cut = `var(--color-${tone})`;
  switch (tone) {
    case "yellow":
      return { from: "var(--color-red)", to: "var(--color-orange)", cut };
    case "red":
      return { from: "var(--color-yellow)", to: "var(--color-paper)", cut };
    default:
      return { from: "var(--color-orange)", to: "var(--color-yellow)", cut };
  }
}
