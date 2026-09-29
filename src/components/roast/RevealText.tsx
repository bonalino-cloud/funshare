"use client";

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from "react";
import { cx } from "@/components/cx";
import { Circled, Squiggle } from "@/components/brand/Doodles";

/** decor: squiggle — розовая змейка под словом, circled — красный овал, который дорисовывается после букв */
export type RevealSegment =
  | string
  | {
      text: string;
      className?: string;
      decor?: "squiggle" | "circled";
      /** Элемент, прикреплённый к концу сегмента (штамп на последней букве). Позиционируется своим className */
      trail?: ReactNode;
    }
  /** Перенос строки только на мобиле: длинная строка desktop делится надвое */
  | { br: "mobile" };

type TextSegment = Exclude<RevealSegment, { br: "mobile" }>;

function decorate(seg: TextSegment, body: ReactNode, after: number) {
  if (typeof seg === "string" || !seg.decor) return body;
  if (seg.decor === "squiggle") return <Squiggle>{body}</Squiggle>;
  return (
    <Circled
      className="[&>svg_path]:[stroke-dasharray:640] [&>svg_path]:[stroke-dashoffset:640] group-data-[shown=true]/reveal:[&>svg_path]:[animation:draw_700ms_var(--ease-poster)_var(--draw-delay)_forwards]"
      style={{ "--draw-delay": `${after}ms` } as CSSProperties}
    >
      {body}
    </Circled>
  );
}

/**
 * Заголовок, который проявляется по буквам: буква выпрыгивает снизу с поворотом.
 * Строки задаются вручную (DESIGN.md §3.3 — автоперенос в display запрещён).
 * Стартует, когда заголовок попадает в экран. Для скринридера — цельный aria-label.
 */
export function RevealText({
  as: Tag = "h2",
  lines,
  className,
  step = 32,
  delay = 0,
  immediate = false,
}: {
  as?: ElementType;
  lines: RevealSegment[][];
  className?: string;
  /** мс между буквами */
  step?: number;
  /** мс до старта */
  delay?: number;
  /** Запуск сразу по CSS, без ожидания гидрации — для hero (первый экран, LCP) */
  immediate?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.dataset.shown = "true";
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const label = lines
    .map((l) => l.map((s) => (typeof s === "string" ? s : "br" in s ? "" : s.text)).join(""))
    .join(" ");
  let i = 0;

  return (
    <Tag
      ref={ref}
      aria-label={label}
      data-shown={immediate ? "true" : undefined}
      className={cx("group/reveal", className)}
    >
      {lines.map((line, li) => (
        <span key={li} aria-hidden="true" className="block whitespace-nowrap">
          {line.map((seg, si) => {
            if (typeof seg !== "string" && "br" in seg)
              return <span key={si} className="block md:hidden" />;
            const text = typeof seg === "string" ? seg : seg.text;
            const chars = Array.from(text).map((ch) => {
              const d = delay + i++ * step;
              return (
                <span
                  key={d}
                  className="inline-block [animation:reveal-char_620ms_var(--ease-poster)_both_paused] opacity-0 group-data-[shown=true]/reveal:[animation-play-state:running]"
                  style={{ animationDelay: `${d}ms` }}
                >
                  {ch === " " ? " " : ch}
                </span>
              );
            });
            const body = (
              <span className={cx("inline-block", typeof seg !== "string" && seg.className)}>
                {chars}
              </span>
            );
            return (
              <span key={si} className="relative inline-block">
                {decorate(seg, body, delay + i * step)}
                {typeof seg !== "string" && seg.trail}
              </span>
            );
          })}
        </span>
      ))}
    </Tag>
  );
}
