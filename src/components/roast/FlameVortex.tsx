"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/components/cx";

/**
 * Водоворот из языков пламени (WebGL2). Языки закручиваются спиралью и затягиваются к центру,
 * в центре — спокойное «окно» (eye) под контент, чтобы заголовок читался.
 *
 * Цвета не хардкодим: берём из токенов поверхности секции (--surface, --flame-a, --flame-b, --eye),
 * поэтому одна и та же анимация работает в тёмной, светлой и цветной теме.
 *
 * Курсор чуть смещает центр воронки, событие `roast:heat` (наведение на CTA) раскручивает её.
 * prefers-reduced-motion — один статичный кадр. Вне экрана — пауза.
 */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uCenter;
uniform vec2 uEyeR;
uniform vec3 uBg;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uEye;
uniform int uMode;
uniform int uFade;
uniform vec2 uMouse;
uniform float uScale;
out vec4 outColor;

// Simplex 3D noise — Ashima Arts / Stefan Gustavson, MIT
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Режим rise: вертикальные языки пламени поднимаются вверх (паттерн пламени из рефа, в цветах поверхности).
// uFade = 1 — огонь густой внизу и гаснет кверху (футер, низ секции).
vec3 rise() {
  float unit = min(uRes.x, uRes.y);
  vec2 p = gl_FragCoord.xy / unit * uScale;
  float t = uTime;
  float warp = snoise(vec3(p.x * 1.2, p.y * 0.8 - t * 0.5, t * 0.1));
  vec3 q = vec3(p.x * 2.6 + warp * 0.45, p.y * 0.9 - t * 0.9, t * 0.12);
  float n = snoise(q) * 0.75 + snoise(q * 2.3 + vec3(0.0, -t, 0.0)) * 0.25;
  float d = 1.0;
  if (uFade == 1) {
    float y = gl_FragCoord.y / uRes.y;
    d = 1.0 - smoothstep(0.0, 0.85, y + snoise(vec3(p.x * 1.5, t * 0.3, 1.0)) * 0.08);
  }
  // Курсор подогревает пламя рядом с собой
  vec2 m = (gl_FragCoord.xy - uMouse) / unit;
  d = clamp(d + 0.45 * exp(-dot(m, m) / 0.02), 0.0, 1.0);
  float aa = fwidth(n) * 1.1 + 0.002;
  float thA = mix(1.3, -0.08, d);
  float thB = mix(1.6, 0.5, d);
  vec3 col = uBg;
  col = mix(col, uA, smoothstep(thA - aa, thA + aa, n));
  col = mix(col, uB, smoothstep(thB - aa, thB + aa, n));
  return col;
}

void main() {
  if (uMode == 1) {
    outColor = vec4(rise(), 1.0);
    return;
  }
  float unit = min(uRes.x, uRes.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / unit - uCenter;
  float r = length(p);
  float a = atan(p.y, p.x);
  float lr = log(r + 0.03);
  float t = uTime;

  // Спираль: угол закручен логарифмом радиуса, узор течёт внутрь (z растёт со временем).
  float tw = a + 1.35 * lr + t * 0.10;
  vec3 q = vec3(cos(tw) * 1.25, sin(tw) * 1.25, lr * 3.4 + t * 0.32);
  float warp = snoise(q * 0.7 + vec3(0.0, 0.0, t * 0.15));
  float n = snoise(q + vec3(warp * 0.55)) * 0.72 + snoise(q * 2.1 + vec3(warp)) * 0.28;

  // Окно под контент: эллипс с огненным краем
  float e = length(p / uEyeR);
  float lick = snoise(vec3(cos(a) * 2.6, sin(a) * 2.6, t * 0.25)) * 0.09
             + snoise(vec3(cos(a) * 7.0, sin(a) * 7.0, t * 0.4)) * 0.035;
  float edge = e + lick;
  float density = smoothstep(0.92, 1.22, edge);

  float aa = fwidth(n) * 1.1 + 0.002;
  float thA = mix(1.3, -0.05, density);
  float thB = mix(1.6, 0.42, density);
  float mA = smoothstep(thA - aa, thA + aa, n);
  float mB = smoothstep(thB - aa, thB + aa, n);
  float ea = fwidth(edge) * 1.2;
  float eyeM = 1.0 - smoothstep(0.96 - ea, 0.96 + ea, edge);

  vec3 col = mix(uBg, uEye, eyeM);
  col = mix(col, uA, mA);
  col = mix(col, uB, mB);
  outColor = vec4(col, 1.0);
}`;

type RGB = [number, number, number];

function readColor(el: Element, name: string): RGB {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const hex = raw.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
  const nums = raw.match(/[\d.]+/g)?.map(Number);
  if (nums && nums.length >= 3) return [nums[0] / 255, nums[1] / 255, nums[2] / 255];
  return [0, 0, 0];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

export function FlameVortex({
  mode = "vortex",
  fade = false,
  scale = 1,
  className,
}: {
  /** vortex — водоворот с окном под контент (hero); rise — поднимающиеся языки пламени (паттерн, футер) */
  mode?: "vortex" | "rise";
  /** rise: огонь густой внизу и гаснет кверху */
  fade?: boolean;
  /** rise: размер языков, больше — мельче */
  scale?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
    if (!gl) return; // фон секции остаётся цветом поверхности

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("uRes");
    const uTime = u("uTime");
    const uCenter = u("uCenter");
    const uEyeR = u("uEyeR");
    const uMouse = u("uMouse");
    gl.uniform1i(u("uMode"), mode === "rise" ? 1 : 0);
    gl.uniform1i(u("uFade"), fade ? 1 : 0);
    gl.uniform1f(u("uScale"), scale);
    gl.uniform2f(uMouse, -9999, -9999);

    const applyColors = () => {
      gl.uniform3fv(u("uBg"), readColor(canvas, "--surface"));
      gl.uniform3fv(u("uA"), readColor(canvas, "--flame-a"));
      gl.uniform3fv(u("uB"), readColor(canvas, "--flame-b"));
      gl.uniform3fv(u("uEye"), readColor(canvas, "--eye"));
    };
    applyColors();

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      // Окно в единицах меньшей стороны: на широком экране — горизонтальный эллипс, на телефоне — вытянутый
      const unit = Math.min(w, h);
      const ax = w / unit;
      const ay = h / unit;
      gl.uniform2f(uEyeR, ax * (w > h ? 0.42 : 0.56), ay * (w > h ? 0.36 : 0.34));
    };
    resize();

    // Состояние воронки
    let time = 7.3;
    let speed = 1;
    let heat = 0;
    const center = { x: 0, y: 0, tx: 0, ty: 0 };
    let visible = true;
    let raf = 0;
    let last = performance.now();

    // Один кадр без цикла: после ресайза canvas очищается, и вне экрана его некому перерисовать
    const draw = () => {
      gl.uniform1f(uTime, time);
      gl.uniform2f(uCenter, center.x, center.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      speed += (1 + heat * 2.2 - speed) * 0.05;
      time += dt * speed;
      center.x += (center.tx - center.x) * 0.04;
      center.y += (center.ty - center.y) * 0.04;
      draw();
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const unit = Math.min(w, h);
      center.tx = ((e.clientX - rect.left - w / 2) / unit) * 0.06;
      center.ty = (-(e.clientY - rect.top - h / 2) / unit) * 0.06;
      const dpr = canvas.width / (w || 1);
      gl.uniform2f(uMouse, (e.clientX - rect.left) * dpr, (h - (e.clientY - rect.top)) * dpr);
    };
    const onHeat = (e: Event) => {
      heat = (e as CustomEvent<number>).detail ?? 0;
    };
    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting;
      if (visible && !was && !reduce) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    // Тема меняется атрибутом data-surface у предка — перечитываем цвета
    const mo = new MutationObserver(() => {
      applyColors();
      draw();
    });
    const surface = canvas.closest("[data-surface]");
    if (surface) mo.observe(surface, { attributes: true, attributeFilter: ["data-surface"] });

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("roast:heat", onHeat);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("roast:heat", onHeat);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, [mode, fade, scale]);

  return (
    <canvas ref={ref} aria-hidden="true" className={cx("block size-full bg-surface", className)} />
  );
}
