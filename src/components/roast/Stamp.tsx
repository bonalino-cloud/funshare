import { cx } from "@/components/cx";

/**
 * Эмблема-штамп в духе нашивки: в центре жёлтый зубчатый «взрыв» с оранжевым огоньком крутится против часовой,
 * кольцо надписи без фона (сверху главная, снизу мелкая, между ними точки) — по часовой. Текст — currentColor.
 * Hover — взрыв крутится быстрее, эмблема чуть подпрыгивает.
 */

// Зубчатая звезда: n лучей, внешний радиус R, внутренний r
function burst(cx: number, cy: number, R: number, r: number, n: number) {
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const rad = i % 2 ? r : R;
    return `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join("L")}Z`;
}

const STAR = burst(100, 100, 60, 44, 12);
// Огонёк по центру взрыва: основание на y=124, кончик на y=74
const FLAME =
  "M100 124C84 122 76 110 81 97c3-8 9-12 7-23 10 7 14 16 13 25 4-5 7-11 6-18 11 11 15 25 9 35-4 6-10 8-16 8Z";

export function Stamp({
  top,
  bottom,
  className,
}: {
  /** Надпись по верхней дуге */
  top: string;
  /** Мелкая подпись по нижней дуге */
  bottom?: string;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cx("group/stamp block aspect-square", className)}>
      <svg
        viewBox="0 0 200 200"
        className="size-full overflow-visible transition-transform duration-300 ease-[var(--ease-poster)] group-hover/stamp:-translate-y-1 group-hover/stamp:scale-105"
      >
        <defs>
          {/* Верх: дуга 220° слева направо по часовой — буквы стоят «головой наружу» */}
          <path id="stamp-top" d="M 28.58 126 A 76 76 0 1 1 171.42 126" />
          {/* Низ: слева направо против часовой — буквы стоят «головой к центру», читаются прямо */}
          <path id="stamp-bottom" d="M 22 100 A 78 78 0 0 0 178 100" />
        </defs>

        {/* Центр крутится против часовой */}
        <g className="origin-[100px_100px] [animation:spin_16s_linear_infinite_reverse] [transform-box:view-box] group-hover/stamp:[animation-duration:3s]">
          <path
            d={STAR}
            className="fill-yellow"
            stroke="#111111"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          {/* Оранжевый огонёк с красной сердцевиной */}
          <path
            d={FLAME}
            className="fill-orange"
            stroke="#111111"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path
            d={FLAME}
            transform="translate(100 124) scale(0.55) translate(-100 -124)"
            className="fill-red"
          />
        </g>

        {/* Кольцо надписей крутится по часовой */}
        <g className="origin-[100px_100px] animate-spin-slow [transform-box:view-box] group-hover/stamp:[animation-duration:3s]">
          <text
            className="fill-current font-wide text-[17px] font-black uppercase"
            letterSpacing="1"
            // Обводка ink под заливкой: надпись читается и там, где ложится на кремовые буквы заголовка
            stroke="#111111"
            strokeWidth="5"
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            <textPath href="#stamp-top" startOffset="50%" textAnchor="middle">
              {top}
            </textPath>
          </text>
          {bottom && (
            <text
              className="fill-current font-wide text-[13px] font-extrabold uppercase"
              letterSpacing="3"
              stroke="#111111"
              strokeWidth="4"
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              <textPath
                href="#stamp-bottom"
                startOffset="50%"
                textAnchor="middle"
                dominantBaseline="hanging"
              >
                {bottom}
              </textPath>
            </text>
          )}
          {/* Точки-разделители между DNGR и надписью сверху */}
          <circle
            cx="156.6"
            cy="156.6"
            r="4.5"
            className="fill-current"
            stroke="#111111"
            strokeWidth="2.5"
            paintOrder="stroke"
          />
          <circle
            cx="43.4"
            cy="156.6"
            r="4.5"
            className="fill-current"
            stroke="#111111"
            strokeWidth="2.5"
            paintOrder="stroke"
          />
        </g>
      </svg>
    </span>
  );
}
