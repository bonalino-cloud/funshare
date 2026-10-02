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
 *
 * На телефоне курсора нет: слои двигает наклон устройства (`deviceorientation`). Отсчёт от
 * того, как человек держит телефон (нейтраль медленно подтягивается к текущему наклону),
 * полный ход уже на ~18°, амплитуда больше. При загрузке слои сами «качаются» полторы
 * секунды, чтобы объём был заметен сразу. iOS отдаёт наклон только после разрешения по жесту:
 * спрашиваем на первом касании, один раз на страницу.
 */

/** Наклон (градусы), при котором слой доезжает до края хода. */
const TILT_RANGE = 18;
/** На телефоне сдвиг заметнее: экран меньше, а наклон грубее мыши. */
const TOUCH_GAIN = 1.6;
/** Как быстро нейтраль догоняет новый наклон (доля за событие). */
const BASE_DRIFT = 0.02;
/** Вступительное «покачивание» на телефоне, мс. */
const INTRO_MS = 1500;

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };
let permissionAsked = false;

/** iOS 13+: разрешение на наклон только из жеста пользователя. Остальным не нужно. */
function askTiltPermissionOnFirstTouch() {
  const DOE = window.DeviceOrientationEvent as unknown as OrientationPermission | undefined;
  if (permissionAsked || !DOE?.requestPermission) return;
  permissionAsked = true;
  const ask = () => {
    DOE.requestPermission?.().catch(() => undefined);
  };
  window.addEventListener("touchend", ask, { once: true });
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
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
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const gain = touch ? TOUCH_GAIN : 1;
    const layers = Array.from(el.querySelectorAll<HTMLElement>("[data-parallax]")).map((node) => {
      const [mx = 0, my = 0, sy = 0] = (node.dataset.parallax ?? "").split(/\s+/).map(Number);
      return { node, mx: mx * gain, my: my * gain, sy };
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
    // Наклон: нейтраль — как человек держит телефон, ход считаем от неё
    const base = { x: NaN, y: NaN };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      // В альбомной ориентации оси меняются местами
      const angle = screen.orientation?.angle ?? 0;
      const [x, y] =
        angle === 90 ? [e.beta, -e.gamma] : angle === 270 ? [-e.beta, e.gamma] : [e.gamma, e.beta];
      if (Number.isNaN(base.x)) {
        base.x = x;
        base.y = y;
      }
      base.x += (x - base.x) * BASE_DRIFT;
      base.y += (y - base.y) * BASE_DRIFT;
      s.tx = clamp((x - base.x) / TILT_RANGE);
      s.ty = clamp((y - base.y) / TILT_RANGE);
      kick();
    };

    // Вступление на телефоне: слои проходят небольшой круг и возвращаются в центр
    let intro = 0;
    if (touch) {
      const start = performance.now();
      const step = (now: number) => {
        const t = (now - start) / INTRO_MS;
        if (t >= 1) {
          s.tx = 0;
          s.ty = 0;
          kick();
          intro = 0;
          return;
        }
        const r = Math.sin(Math.PI * t) * 0.7;
        s.tx = Math.cos(t * Math.PI * 2) * r;
        s.ty = Math.sin(t * Math.PI * 2) * r;
        kick();
        intro = requestAnimationFrame(step);
      };
      intro = requestAnimationFrame(step);
    }

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

    if (touch) {
      askTiltPermissionOnFirstTouch();
      window.addEventListener("deviceorientation", onTilt);
    } else {
      window.addEventListener("pointermove", onMove, { passive: true });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(intro);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return <section ref={ref} {...props} />;
}
