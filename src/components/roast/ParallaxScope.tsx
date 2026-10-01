"use client";

import { useEffect, useRef, type HTMLAttributes } from "react";
import { fxDisabled } from "@/lib/client/fx";

/**
 * Секция с параллаксом. Слои внутри помечены `data-parallax="mx my sy"`: сдвиг в px на единицу
 * положения курсора по X и Y (от −1 до 1, со сглаживанием) и коэффициент прокрутки секции
 * (0, когда верх секции у верха экрана; растёт при прокрутке вниз). Сдвиг пишется в `translate`
 * каждого слоя напрямую — CSS-переменные на секции заставляли бы браузер пересчитывать стили
 * всего дерева (в hero больше тысячи узлов) на каждый кадр.
 *
 * Слоям нужен `will-change-transform`, чтобы сдвиг шёл на композиторе без перерисовки.
 * Цикл кадров крутится, только пока курсор «не доехал» и секция на экране; положение секции
 * кэшируется, чтобы не дёргать layout на каждый кадр.
 */
export function ParallaxScope(props: HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (
      !el ||
      fxDisabled("parallax") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const layers = Array.from(el.querySelectorAll<HTMLElement>("[data-parallax]")).map((node) => {
      const [mx = 0, my = 0, sy = 0] = (node.dataset.parallax ?? "").split(/\s+/).map(Number);
      return { node, mx, my, sy };
    });
    const s = { x: 0, y: 0, tx: 0, ty: 0, sy: 0 };
    let raf = 0;
    let visible = true;
    // Верх секции в координатах документа — пересчитываем при ресайзе, а не каждый кадр
    let top = 0;
    const measure = () => {
      top = el.getBoundingClientRect().top + window.scrollY;
    };
    measure();

    const apply = () => {
      for (const l of layers) {
        l.node.style.translate = `${(s.x * l.mx).toFixed(2)}px ${(s.y * l.my + s.sy * l.sy).toFixed(2)}px`;
      }
    };
    const tick = () => {
      raf = 0;
      s.x += (s.tx - s.x) * 0.08;
      s.y += (s.ty - s.y) * 0.08;
      apply();
      const settled = Math.abs(s.tx - s.x) < 0.002 && Math.abs(s.ty - s.y) < 0.002;
      if (!settled && visible) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf && visible) raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      s.tx = (e.clientX / window.innerWidth) * 2 - 1;
      s.ty = (e.clientY / window.innerHeight) * 2 - 1;
      kick();
    };
    const onScroll = () => {
      if (!visible) return;
      s.sy = Math.round(window.scrollY - top);
      apply();
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        onScroll();
        kick();
      }
    });
    io.observe(el);
    const ro = new ResizeObserver(() => {
      measure();
      onScroll();
    });
    ro.observe(document.documentElement);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return <section ref={ref} {...props} />;
}
