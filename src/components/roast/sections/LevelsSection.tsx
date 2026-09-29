"use client";

import Image, { type StaticImageData } from "next/image";
import { useState, type ReactNode } from "react";
import { Asterisk } from "@/components/brand/Asterisk";
import { cx } from "@/components/cx";
import { cardTones, type CardTone } from "@/components/ui/Card";
import { Flames } from "../Flames";
import { Chili, Cup, Headphones, Play, Suitcase, Sunset } from "../Icons";
import { Reveal } from "../Reveal";
import { Section, SectionHeading } from "../Section";
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
  cut: string;
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
    cut: "var(--color-yellow)",
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
    cut: "var(--color-orange)",
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
    cut: "var(--color-red)",
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

/** «Вот что получится»: три сборки-вкладки, справа — пример прожарки выбранной сборки */
export function LevelsSection() {
  const [active, setActive] = useState(1);
  const level = levels[active];

  return (
    <Section id="levels" surface="light" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <SectionHeading
          label="Сборки"
          lines={[["Вот что ", { br: "mobile" }, { text: "полу", className: "tilt" }, "чится"]]}
        />

        <div
          role="tablist"
          aria-label="Сборка"
          className="mt-14 grid gap-5 md:mt-20 md:grid-cols-3"
        >
          {levels.map((l, i) => (
            <Reveal key={l.name} delay={i * 90}>
              <button
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={cx(
                  "group/flames relative flex h-full w-full flex-col items-start overflow-visible rounded-lg border-2 p-5 pt-40 text-left transition-[transform,box-shadow] duration-200 ease-[var(--ease-poster)] md:p-6 md:pt-48",
                  cardTones[l.tone],
                  i === active
                    ? "-translate-y-2 -rotate-1 border-ink shadow-offset"
                    : "border-transparent hover:-translate-y-1 hover:rotate-1",
                )}
              >
                <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                  <Flames
                    trigger="hover"
                    particle="sm"
                    cut={l.cut}
                    className="inset-x-0 bottom-0 h-24 [--rise:-80px]"
                  />
                </span>
                <Image
                  src={l.img}
                  alt=""
                  sizes="240px"
                  className="absolute -top-10 left-1/2 h-48 w-auto -translate-x-1/2 transition-transform duration-300 ease-[var(--ease-poster)] group-hover/flames:scale-105 group-hover/flames:-rotate-3 md:h-56"
                />
                {l.free && (
                  <span className="absolute top-3 right-3 rotate-6 rounded-sm border-2 border-ink bg-pink px-2 py-1 type-label text-ink">
                    Бесплатно
                  </span>
                )}
                <span className="relative flex gap-0.5">
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
          ))}
        </div>

        <div
          key={active}
          className="mt-12 grid [animation:swap-in_360ms_var(--ease-poster)] items-start gap-8 md:mt-16 md:grid-cols-[1fr_1.2fr] md:gap-12"
        >
          <div>
            <p className="type-label text-[color:var(--muted)]">Что входит · {level.name}</p>
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

          <article className="relative rounded-md border-2 border-ink bg-ink p-5 text-paper shadow-offset md:p-7">
            <div className="flex items-center justify-between gap-3">
              <p className="type-label text-paper/70">Прожарка @anya.travels</p>
              <span className={cx("rounded-sm px-2 py-1 type-label", cardTones[level.tone])}>
                {level.name}
              </span>
            </div>
            <p className="mt-4 font-wide text-xl leading-tight font-extrabold uppercase md:text-2xl">
              Человек, у которого 40 сторис из аэропорта и ноль из дома
            </p>

            {level.images > 0 && (
              <div
                className={cx(
                  "mt-5 grid gap-3",
                  level.images === 4 ? "grid-cols-4" : "grid-cols-2",
                )}
              >
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

            <ul className="mt-5 space-y-3">
              {punches.map((p) => (
                <li key={p.text} className="group flex items-start gap-3 type-body">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-12 [&>svg]:size-6">
                    {p.icon}
                  </span>
                  <span className="pt-1.5">{p.text}</span>
                </li>
              ))}
            </ul>

            <p className="mt-5 rounded-md bg-yellow p-4 type-body font-semibold text-ink">
              Но если честно: ты та, кто знает, где продолжить вечер. Это уважение.
            </p>

            {level.video && (
              <a
                href="#video"
                className="group mt-4 flex items-center gap-3 rounded-md border-2 border-paper p-3 transition-colors duration-200 hover:bg-paper hover:text-ink"
              >
                <span className="grid size-10 place-items-center rounded-full bg-red text-ink transition-transform duration-200 group-hover:scale-110">
                  <Play className="ml-0.5 size-4" />
                </span>
                <span className="type-label">Видео 9:16 для сторис</span>
              </a>
            )}
          </article>
        </div>
      </div>
    </Section>
  );
}
