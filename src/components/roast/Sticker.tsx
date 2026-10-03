"use client";

import Image, { type StaticImageData } from "next/image";
import { useRef, type CSSProperties } from "react";
import { cx } from "@/components/cx";

/**
 * Стикер-иллюстрация: реагирует на всё. Hover — поворот и подъём, курсор — параллакс
 * по глубине depth (слой ParallaxScope, data-parallax), стикер можно схватить и перетащить.
 */
export function Sticker({
  src,
  alt = "",
  width,
  depth = 1,
  rotate = 0,
  className,
  style,
  priority,
}: {
  src: StaticImageData;
  alt?: string;
  /** ширина в px; на мобиле уменьшай через className-обёртку */
  width: number;
  depth?: number;
  rotate?: number;
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const drag = useRef({ x: 0, y: 0, sx: 0, sy: 0, on: false });

  const onDown = (e: React.PointerEvent) => {
    const d = drag.current;
    d.on = true;
    d.sx = e.clientX - d.x;
    d.sy = e.clientY - d.y;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    inner.current?.setAttribute("data-grab", "true");
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.on || !inner.current) return;
    d.x = e.clientX - d.sx;
    d.y = e.clientY - d.sy;
    inner.current.style.translate = `${d.x}px ${d.y}px`;
  };
  const onUp = () => {
    drag.current.on = false;
    inner.current?.removeAttribute("data-grab");
  };

  return (
    <div
      data-parallax={`${depth * 18} ${depth * 14} ${depth * -0.12}`}
      className={cx("absolute will-change-transform select-none", className)}
      style={style}
    >
      <div
        ref={inner}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="group/st cursor-grab touch-none data-[grab=true]:cursor-grabbing"
      >
        <div
          className="[rotate:var(--r)] transition-transform duration-200 ease-[var(--ease-poster)] group-hover/st:scale-110 group-hover/st:rotate-[calc(var(--r)+8deg)] group-data-[grab=true]/st:scale-[1.18]"
          style={{ "--r": `${rotate}deg` } as CSSProperties}
        >
          <Image
            src={src}
            alt={alt}
            draggable={false}
            priority={priority}
            className="h-auto"
            style={{ width }}
            sizes={`${Math.round(width * 1.5)}px`}
          />
        </div>
      </div>
    </div>
  );
}
