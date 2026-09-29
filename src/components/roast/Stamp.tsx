import { cx } from "@/components/cx";

/**
 * Эмблема-штамп в духе нашивки: в центре жёлтый зубчатый «взрыв» с красным ✱ — он вращается;
 * вокруг надпись без фона: сверху по дуге главная, снизу мелкая подпись. Текст — currentColor.
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

        <g className="origin-center animate-spin-slow [transform-box:fill-box] group-hover/stamp:[animation-duration:3s]">
          <path
            d={STAR}
            className="fill-yellow"
            stroke="#111111"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          {/* ✱ — знак системы, радиально симметричный: хорошо смотрится в движении */}
          <g className="fill-red" stroke="#111111" strokeWidth="3.5">
            {Array.from({ length: 6 }, (_, i) => (
              <ellipse
                key={i}
                cx="100"
                cy="78"
                rx="9"
                ry="20"
                transform={`rotate(${i * 60} 100 100)`}
              />
            ))}
          </g>
          <circle cx="100" cy="100" r="11" className="fill-red" />
        </g>

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
      </svg>
    </span>
  );
}
