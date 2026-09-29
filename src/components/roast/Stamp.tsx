import { cx } from "@/components/cx";
import { Asterisk } from "@/components/brand/Asterisk";

/**
 * Круглый штамп с текстом по кругу. Медленно вращается, на hover — вздрагивает.
 * Текст — в SVG textPath, растянут на всю окружность, шрифт Yanone (type.ticker).
 */
export function Stamp({ text, className }: { text: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cx("group/stamp block aspect-square", className)}>
      <span className="grid size-full place-items-center rounded-full border-[3px] border-ink bg-yellow text-ink shadow-offset transition-transform duration-200 group-hover/stamp:scale-110 group-hover/stamp:-rotate-12">
        <svg viewBox="0 0 200 200" className="absolute size-full animate-spin-slow">
          <defs>
            <path id="stamp-circle" d="M100 100 m-72 0 a72 72 0 1 1 144 0 a72 72 0 1 1 -144 0" />
          </defs>
          <text className="fill-ink font-cond text-[26px] font-bold uppercase">
            <textPath href="#stamp-circle" textLength="448" lengthAdjust="spacing">
              {text}
            </textPath>
          </text>
        </svg>
        <Asterisk className="size-[34%] text-red transition-transform duration-500 group-hover/stamp:rotate-180" />
      </span>
    </span>
  );
}
