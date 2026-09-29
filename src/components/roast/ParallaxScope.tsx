"use client";

import { useEffect, useRef, type HTMLAttributes } from "react";

/**
 * Секция с параллаксом: пишет в CSS-переменные положение курсора (--mx, --my от −1 до 1,
 * со сглаживанием) и прокрутку (--sy, px). Слои внутри сдвигаются на свою глубину через translate.
 */
export function ParallaxScope(props: HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const s = { x: 0, y: 0, tx: 0, ty: 0 };
    let raf = 0;
    const tick = () => {
      s.x += (s.tx - s.x) * 0.08;
      s.y += (s.ty - s.y) * 0.08;
      el.style.setProperty("--mx", s.x.toFixed(4));
      el.style.setProperty("--my", s.y.toFixed(4));
      el.style.setProperty("--sy", String(Math.round(window.scrollY)));
      raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      s.tx = (e.clientX / window.innerWidth) * 2 - 1;
      s.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <section ref={ref} {...props} />;
}
