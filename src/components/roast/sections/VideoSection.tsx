"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/cx";
import { Button } from "@/components/ui/Button";
import { Flames } from "../Flames";
import { Chili, Play } from "../Icons";
import { Reveal } from "../Reveal";
import { Section, SectionHeading } from "../Section";
import { Sticker } from "../Sticker";
import { resultImages } from "../assets/results";
import match from "../assets/sticker-match.png";
import flame from "../assets/sticker-flame.png";

const SLIDE_MS = 2200;

/** «В сторис или в рилс»: продаёт Пекло. Телефон проигрывает пример и наклоняется за курсором */
export function VideoSection() {
  return (
    <Section id="video" surface="color" className="py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 md:grid-cols-[minmax(0,1fr)_300px] md:gap-20 md:px-6">
        <div>
          <SectionHeading
            lines={[
              ["Прожарка,"],
              ["которая"],
              ["сама себя"],
              [{ text: "выкла", className: "tilt" }, "дывает"],
            ]}
          />
          <Reveal>
            <p className="mt-6 max-w-[34ch] type-lead">
              Вертикальное видео под сторис и рилс. Картинки в огне, вердикт в конце. Скачал и
              выложил.
            </p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-sm border-2 border-ink bg-paper px-3 py-1.5 type-label text-ink">
              Входит в сборку Пекло
              <span className="flex">
                <Chili className="size-5" />
                <Chili className="size-5" />
                <Chili className="size-5" />
              </span>
            </p>
            <div className="mt-8">
              <Button variant="inverse" arrow={false} icon={<Play className="size-5" />}>
                Смотреть пример
              </Button>
            </div>
          </Reveal>
        </div>
        <div className="relative mx-auto w-full max-w-[300px] max-md:w-[72%]">
          <Phone />
          <Sticker src={match} width={100} depth={1.6} rotate={-20} className="-top-8 -left-14" />
          <Sticker src={flame} width={90} depth={2.2} rotate={14} className="-right-12 bottom-16" />
        </div>
      </div>
    </Section>
  );
}

function Phone() {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const slides = resultImages.length + 1; // последний кадр — вердикт

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % slides), SLIDE_MS);
    return () => clearInterval(id);
  }, [slides]);

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${x * 16}deg) rotateX(${-y * 12}deg)`;
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="relative aspect-[9/16] w-full rotate-3 rounded-[36px] border-[6px] border-ink bg-ink shadow-offset transition-transform duration-200 ease-out"
    >
      <div className="absolute inset-0 overflow-hidden rounded-[30px]">
        {resultImages.map((src, k) => (
          <Image
            key={k}
            src={src}
            alt=""
            sizes="320px"
            className={cx(
              "absolute inset-0 size-full object-cover transition-[opacity,scale] duration-500",
              k === i ? "scale-100 opacity-100" : "scale-110 opacity-0",
            )}
          />
        ))}
        <div
          className={cx(
            "absolute inset-0 grid place-items-center bg-red p-6 text-center transition-opacity duration-500",
            i === slides - 1 ? "opacity-100" : "opacity-0",
          )}
        >
          <p className="font-wide text-2xl leading-tight font-black text-ink uppercase">
            40 сторис из аэропорта. Ноль из дома
          </p>
        </div>
        {/* Картинки горят снизу */}
        <Flames particle="sm" cut={null} className="inset-x-0 bottom-0 h-28 [--rise:-100px]" />
        {/* Полоски прогресса, как в сторис */}
        <div className="absolute inset-x-3 top-3 flex gap-1">
          {Array.from({ length: slides }, (_, k) => (
            <span key={k} className="h-1 flex-1 overflow-hidden rounded-full bg-paper/35">
              <span
                className={cx(
                  "block h-full origin-left bg-paper",
                  k < i && "scale-x-100",
                  k > i && "scale-x-0",
                  k === i && "animate-[story-progress_2200ms_linear_forwards]",
                )}
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
