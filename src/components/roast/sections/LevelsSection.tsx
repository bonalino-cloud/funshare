"use client";

import Image, { type StaticImageData } from "next/image";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Asterisk } from "@/components/brand/Asterisk";
import { cx } from "@/components/cx";
import { cardTones, type CardTone } from "@/components/ui/Card";
import { Flames, flameOn } from "../Flames";
import { Chili, Cup, Headphones, Play, Suitcase, Sunset } from "../Icons";
import { Reveal } from "../Reveal";
import { RevealText } from "../RevealText";
import { Section } from "../Section";
import ogon from "../assets/level-ogon.png";
import koster from "../assets/level-koster.png";
import peklo from "../assets/level-peklo.png";
import { resultImages } from "../assets/results";

type Level = {
  name: string;
  heat: number;
  sub: string;
  img: StaticImageData;
  tone: CardTone;
  images: number;
  free?: boolean;
  video?: boolean;
  includes: string[];
};

const base = [
  "Вердикт в одну строку. Он же заголовок для сторис",
  "4–6 панчей про привычки и вайб",
  "«Но если честно» в конце, чтобы не обиделись",
  "Ссылка с превью для Telegram и WhatsApp",
];

const levels: Level[] = [
  {
    name: "Поджог",
    heat: 1,
    sub: "Только шутки, только текст",
    img: ogon,
    tone: "yellow",
    images: 0,
    free: true,
    includes: base,
  },
  {
    name: "Кострище",
    heat: 2,
    sub: "Шутки + 2 картинки",
    img: koster,
    tone: "orange",
    images: 2,
    includes: [
      ...base.slice(0, 2),
      "2 картинки в одном стиле, по мотивам профиля",
      ...base.slice(2),
    ],
  },
  {
    name: "Пекло",
    heat: 3,
    sub: "Шутки + 4 картинки + видео для сторис",
    img: peklo,
    tone: "red",
    images: 4,
    video: true,
    includes: [
      ...base.slice(0, 2),
      "4 картинки в одном стиле, по мотивам профиля",
      "Видео 9:16 на 15 сек: картинки горят, вердикт в конце",
      "Обложка-открытка для ДР или ответки",
      ...base.slice(2),
    ],
  },
];

const punches: { icon: ReactNode; text: string }[] = [
  {
    icon: <Suitcase />,
    text: "«Пересадка 6 часов» звучит у тебя как достижение, а не как ошибка планирования",
  },
  { icon: <Cup />, text: "Кофе фотографируешь чаще, чем пьёшь. Кофе в курсе" },
  { icon: <Sunset />, text: "Закаты. Все. Даже из такси. Даже когда их нет" },
  { icon: <Headphones />, text: "Плейлист «для дороги» длиннее самой дороги" },
];

/** Декоративные языки пламени в углу карточки Кострища: плоские, red + yellow (DESIGN.md §7).
 * При наведении прячутся — их сменяет живой огонь Flames */
function CornerFlames({ className }: { className?: string }) {
  const tongue =
    "M50 160C18 154 4 124 16 94c6-15 10-28 4-48 20 12 32 30 30 52 8-8 14-22 12-38 22 22 38 58 30 84-6 16-20 24-42 16Z";
  return (
    <svg viewBox="0 0 240 170" aria-hidden="true" className={className}>
      <g className="origin-bottom animate-[flicker_1.6s_ease-in-out_infinite] [transform-box:fill-box]">
        <path
          d={tongue}
          transform="translate(0 10) scale(0.9)"
          className="fill-red"
          stroke="#111"
          strokeWidth="4"
        />
        <path d={tongue} transform="translate(26 70) scale(0.5)" className="fill-yellow" />
      </g>
      <g className="origin-bottom animate-[flicker_1.3s_ease-in-out_infinite_-0.4s] [transform-box:fill-box]">
        <path
          d={tongue}
          transform="translate(80 -10) scale(1.05)"
          className="fill-red"
          stroke="#111"
          strokeWidth="4"
        />
        <path d={tongue} transform="translate(112 60) scale(0.6)" className="fill-yellow" />
      </g>
      <g className="origin-bottom animate-[flicker_1.8s_ease-in-out_infinite_-0.8s] [transform-box:fill-box]">
        <path
          d={tongue}
          transform="translate(160 30) scale(0.8)"
          className="fill-red"
          stroke="#111"
          strokeWidth="4"
        />
        <path d={tongue} transform="translate(184 86) scale(0.45)" className="fill-yellow" />
      </g>
    </svg>
  );
}

/** «Вот что получится»: три сборки-вкладки. Состав и пример прожарки появляются сразу под выбранной
 * карточкой на мобиле и под всем рядом на десктопе — одна разметка, порядок задаёт CSS order */
export function LevelsSection() {
  const [active, setActive] = useState(1);
  const level = levels[active];

  return (
    <Section id="levels" surface="light" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        {/* «Получится Огонь»: по центру; «Огонь» — окно в поднимающиеся языки пламени (маска по буквам) */}
        <h2 aria-label="Получится огонь" className="text-center">
          <RevealText as="span" className="block type-display-m" lines={[["Получится"]]} />
          <Reveal as="span" delay={300} className="block">
            <span className="inline-block fire-text font-wide text-[clamp(5rem,17vw,12.5rem)] leading-[0.95] font-black tracking-[-0.03em]">
              Огонь
            </span>
          </Reveal>
        </h2>

        <div className="mt-14 grid gap-5 md:mt-20 md:grid-cols-3">
          {levels.map((l, i) => {
            const fire = flameOn(l.tone);
            return (
              <Reveal
                key={l.name}
                delay={i * 90}
                className="order-[var(--o)] md:order-none"
                style={{ "--o": i * 2 } as CSSProperties}
              >
                <button
                  aria-pressed={i === active}
                  aria-controls="level-details"
                  onClick={() => setActive(i)}
                  className={cx(
                    "group/flames relative flex h-full w-full flex-col items-start justify-end overflow-visible rounded-lg border-2 p-5 pt-40 text-left transition-[transform,box-shadow] duration-200 ease-[var(--ease-poster)] md:p-6 md:pt-48",
                    cardTones[l.tone],
                    i === active
                      ? "-translate-y-2 -rotate-1 border-ink shadow-offset"
                      : "border-transparent hover:-translate-y-1 hover:rotate-1",
                  )}
                >
                  <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                    {l.heat === 2 && (
                      <CornerFlames className="absolute -right-2 -bottom-1 w-24 transition-opacity duration-200 group-hover/flames:opacity-0 md:w-28" />
                    )}
                    <Flames
                      trigger="hover"
                      particle="sm"
                      cut={fire.cut}
                      from={fire.from}
                      to={fire.to}
                      className="inset-x-0 bottom-0 h-32 [--rise:-110px]"
                    />
                  </span>
                  <Image
                    src={l.img}
                    alt=""
                    sizes="260px"
                    className="absolute -top-10 left-1/2 h-48 w-auto -translate-x-1/2 transition-transform duration-300 ease-[var(--ease-poster)] group-hover/flames:scale-105 group-hover/flames:-rotate-3 md:h-56"
                  />
                  {l.free && (
                    <span className="absolute top-3 right-3 rotate-6 rounded-sm border-2 border-ink bg-pink px-2 py-1 type-label text-ink">
                      Бесплатно
                    </span>
                  )}
                  <span className="relative flex -space-x-2.5">
                    {Array.from({ length: l.heat }, (_, k) => (
                      <Chili
                        key={k}
                        className="size-7 transition-transform duration-200 group-hover/flames:-rotate-12"
                      />
                    ))}
                  </span>
                  <span className="relative mt-2 type-cond-xl">{l.name}</span>
                  <span className="relative mt-1 type-body font-semibold">{l.sub}</span>
                </button>
              </Reveal>
            );
          })}

          <div
            id="level-details"
            key={active}
            aria-live="polite"
            className="order-[var(--o)] mt-4 grid [animation:swap-in_360ms_var(--ease-poster)] items-start gap-8 md:order-last md:col-span-3 md:mt-12 md:grid-cols-[1fr_1.2fr] md:gap-12"
            style={{ "--o": active * 2 + 1 } as CSSProperties}
          >
            <div>
              <h3 className="type-display-m">Что входит в {level.name}</h3>
              <ul className="mt-5 space-y-3">
                {level.includes.map((t) => (
                  <li
                    key={t}
                    className="group flex items-start gap-3 type-lead transition-transform duration-200 hover:translate-x-1"
                  >
                    <Asterisk className="mt-1 size-4 shrink-0 text-red transition-transform duration-500 group-hover:rotate-[120deg]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <ResultCard level={level} />
          </div>
        </div>
      </div>
    </Section>
  );
}

/** Пример прожарки @anya.travels: вердикт, панчи белыми плашками вразнобой, картинки, «но если честно» */
function ResultCard({ level }: { level: Level }) {
  return (
    <article className="relative rounded-md border-2 border-ink bg-ink p-5 text-paper shadow-offset md:p-7">
      <div className="flex items-center justify-between gap-3">
        <p className="type-meta text-paper/70">Прожарка @anya.travels</p>
        <span className={cx("rounded-sm px-2 py-1 type-label", cardTones[level.tone])}>
          {level.name}
        </span>
      </div>
      <p className="mt-4 font-wide text-xl leading-tight font-extrabold uppercase md:text-2xl">
        Человек, у которого 40 сторис из аэропорта и ноль из дома
      </p>

      {/* Панчи: белые плашки, наклон попеременно по и против часовой, влетают по одной */}
      <ul className="mt-6 space-y-3">
        {punches.map((p, k) => (
          <Reveal as="li" key={p.text} delay={150 + k * 180}>
            <div
              className={cx(
                "group flex items-center gap-3 rounded-md border-2 border-ink bg-white px-3 py-2.5 text-ink shadow-offset-paper transition-transform duration-200 ease-[var(--ease-poster)] hover:scale-[1.02] hover:rotate-0",
                k % 2 ? "-rotate-[1.6deg]" : "rotate-[1.4deg]",
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-yellow transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-12 [&>svg]:size-6">
                {p.icon}
              </span>
              <span className="type-body font-semibold">{p.text}</span>
            </div>
          </Reveal>
        ))}
      </ul>

      {level.images > 0 && (
        <div className={cx("mt-6 grid gap-3", level.images === 4 ? "grid-cols-4" : "grid-cols-2")}>
          {resultImages.slice(0, level.images).map((src, k) => (
            <Image
              key={k}
              src={src}
              alt=""
              sizes="(max-width: 768px) 45vw, 260px"
              className={cx(
                "aspect-[4/5] w-full rounded-md border-2 border-paper object-cover transition-transform duration-200 hover:z-10 hover:scale-105",
                k % 2 ? "hover:rotate-2" : "hover:-rotate-2",
              )}
            />
          ))}
        </div>
      )}

      <Honest />

      {level.video && (
        <a
          href="#video"
          className="group mt-5 flex items-center gap-3 rounded-md border-2 border-paper p-3 transition-colors duration-200 hover:bg-paper hover:text-ink"
        >
          <span className="grid size-10 place-items-center rounded-full bg-red text-ink transition-transform duration-200 group-hover:scale-110">
            <Play className="ml-0.5 size-4" />
          </span>
          <span className="type-label">Видео 9:16 для сторис</span>
        </a>
      )}
    </article>
  );
}

/** «Но если честно»: записка на скотче — тёплый финал прожарки */
function Honest() {
  return (
    <div className="group relative mt-8 -rotate-2 rounded-md border-2 border-ink bg-paper px-5 pt-6 pb-5 text-ink shadow-offset-paper transition-transform duration-300 ease-[var(--ease-poster)] hover:rotate-0">
      {/* Скотч */}
      <span aria-hidden="true" className="absolute -top-3 left-6 h-6 w-16 -rotate-6 bg-yellow/85" />
      <span
        aria-hidden="true"
        className="absolute -top-3 right-8 h-6 w-12 rotate-[8deg] bg-yellow/85"
      />
      {/* Штампик-сердце заменяем знаком ✱ — эмодзи запрещены */}
      <span
        aria-hidden="true"
        className="absolute -right-4 -bottom-4 grid size-14 place-items-center rounded-full border-2 border-ink bg-red text-paper transition-transform duration-500 group-hover:rotate-[120deg]"
      >
        <Asterisk className="size-7" />
      </span>
      <p className="font-cond text-3xl leading-none font-bold text-red uppercase md:text-4xl">
        Но если <span className="tilt">честно</span>
      </p>
      <p className="mt-3 max-w-[32ch] font-wide text-lg leading-snug font-extrabold uppercase">
        Ты та, кто знает, где продолжить вечер.
      </p>
      <p className="mt-2 type-body font-semibold">Это уважение.</p>
    </div>
  );
}
