"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/cx";
import { FlameVortex } from "./FlameVortex";
import { jitterFor } from "./RevealText";

/**
 * Слово, внутри которого горит огонь футера (FlameVortex rise, поверхность dark: base + red + orange).
 * Буквы — маска: каждая буква с разбросом ширины и жирности рисуется на скрытом 2D-canvas по своим
 * реальным координатам из DOM, шейдер показывает пламя только в этих пикселях.
 * Под canvas лежит тот же текст цветом ink — если WebGL недоступен, слово всё равно читается.
 */
export function FireWord({
  text,
  jitter = true,
  className,
}: {
  text: string;
  /** Разброс ширины и жирности букв; false — ровный набор, как у заголовка hero */
  jitter?: boolean;
  className?: string;
}) {
  const wrap = useRef<HTMLSpanElement>(null);
  const layer = useRef<HTMLSpanElement>(null);
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  const [maskKey, setMaskKey] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    const over = layer.current;
    if (!el || !over) return;
    const cv = document.createElement("canvas");

    const paint = () => {
      // Трафарет в координатах слоя огня: он шире слова, растянутые крайние буквы не обрезаются
      const box = over.getBoundingClientRect();
      if (!box.width) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cv.width = Math.round(box.width * dpr);
      cv.height = Math.round(box.height * dpr);
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      el.querySelectorAll<HTMLElement>("[data-ch]").forEach((s) => {
        const cs = getComputedStyle(s);
        const b = s.getBoundingClientRect();
        const k = Number(s.dataset.k);
        const ch = s.textContent ?? "";
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const m = ctx.measureText(ch);
        // Базовая линия как у CSS: половина интерлиньяжа сверху + ascent шрифта
        const content = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
        const baseline = b.top - box.top + (b.height - content) / 2 + m.fontBoundingBoxAscent;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.translate(b.left - box.left + b.width / 2, baseline);
        ctx.scale(k, 1);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      });
      el.dataset.masked = "true";
      setMask(cv);
      setMaskKey((n) => n + 1);
    };

    let alive = true;
    document.fonts.ready.then(() => alive && paint());
    const ro = new ResizeObserver(() => paint());
    ro.observe(el);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [text]);

  return (
    <span ref={wrap} aria-label={text} className={cx("relative inline-block", className)}>
      {/* Запасной текст для браузеров без WebGL; когда трафарет готов — прячем, чтобы не было тёмной кромки */}
      <span aria-hidden="true" className="text-ink in-data-[masked=true]:text-transparent">
        {Array.from(text).map((ch, i) => {
          // Пробел — обычный текст: по нему строка переносится на узком экране
          if (ch === " ") return " ";
          const { k, w } = jitter ? jitterFor(i) : { k: 1, w: undefined };
          return (
            <span
              key={i}
              data-ch
              data-k={k}
              className="inline-block origin-center"
              style={
                jitter
                  ? {
                      transform: `scaleX(${k})`,
                      margin: `0 ${((k - 1) * 0.5).toFixed(3)}em`,
                      fontWeight: w,
                    }
                  : undefined
              }
            >
              {ch}
            </span>
          );
        })}
      </span>
      <span
        ref={layer}
        aria-hidden="true"
        data-surface="dark"
        className="pointer-events-none absolute -inset-x-[0.2em] -inset-y-[0.08em] block bg-transparent"
      >
        <FlameVortex mode="rise" mask={mask} maskKey={maskKey} scale={1.6} />
      </span>
    </span>
  );
}
