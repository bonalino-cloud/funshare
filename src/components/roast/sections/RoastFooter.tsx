import { Asterisk } from "@/components/brand/Asterisk";
import { ArrowNE } from "@/components/brand/Doodles";
import { FlameVortex } from "../FlameVortex";

const links = ["Что ещё есть", "Правила", "Удалить мою прожарку"];

/** Футер в огне: пламя поднимается снизу за огромным словом, сверху — ссылки (DESIGN.md §8.11) */
export function RoastFooter() {
  return (
    <footer
      data-surface="dark"
      className="relative isolate overflow-hidden bg-surface text-on-surface"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-14 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex gap-1 text-red" aria-hidden="true">
            <Asterisk className="size-4 animate-spin-slow" />
            <Asterisk className="size-4 animate-spin-slow [animation-delay:-4s]" />
            <Asterisk className="size-4 animate-spin-slow [animation-delay:-8s]" />
          </span>
          <span className="type-meta">Funshare · прожарка · 2026</span>
        </div>
        <nav className="flex flex-wrap gap-2">
          {links.map((l) => (
            <a
              key={l}
              href="#"
              className="group inline-flex items-center gap-1.5 rounded-sm border-2 border-paper px-3 py-2 type-label transition-[transform,background-color,color] duration-200 hover:-rotate-2 hover:bg-paper hover:text-ink"
            >
              {l}
              <ArrowNE className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          ))}
        </nav>
      </div>
      <div className="relative mt-10 h-[22vw] max-h-[320px] min-h-36">
        <div aria-hidden="true" className="absolute inset-0 -z-10">
          <FlameVortex mode="rise" fade scale={1.4} />
        </div>
        <p
          aria-hidden="true"
          className="absolute inset-x-0 bottom-[-0.12em] text-center font-wide text-[12vw] leading-none font-black tracking-tight text-paper uppercase mix-blend-normal"
        >
          Прожарка
        </p>
      </div>
    </footer>
  );
}
