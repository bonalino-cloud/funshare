"use client";

import Image from "next/image";
import { Reveal } from "../Reveal";
import { Section, SectionHeading } from "../Section";
import { Sticker } from "../Sticker";
import shareImp from "../assets/share-imp.png";
import match from "../assets/sticker-match.png";
import flame from "../assets/sticker-flame.png";

/** «Прожарка, которая готова к сторис»: продаёт сторис. Справа чёртик на самолётике «поделиться» */
export function VideoSection() {
  return (
    <Section id="video" surface="color" className="py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 md:grid-cols-[minmax(0,1fr)_300px] md:gap-20 md:px-6">
        <div>
          <SectionHeading
            lines={[
              ["Прожарка,"],
              ["которая"],
              ["готова"],
              ["к ", { text: "сторис", className: "tilt" }],
            ]}
          />
          <Reveal>
            <p className="mt-6 max-w-[34ch] type-lead">
              Вертикальный формат с шутками и картинками. Жди огненных реакций!
            </p>
          </Reveal>
        </div>
        <div className="relative mx-auto w-full max-w-[300px] max-md:w-[72%]">
          {/* Чёртик на бумажном самолётике со стопкой картинок: «поделиться» (nano-banana-pro 2K) */}
          <Image
            src={shareImp}
            alt="Чёртик летит на бумажном самолётике со стопкой картинок"
            sizes="(max-width: 768px) 72vw, 300px"
            className="relative h-auto w-full"
          />
          <Sticker src={match} width={100} depth={1.6} rotate={-20} className="-top-8 -left-14" />
          <Sticker src={flame} width={90} depth={2.2} rotate={14} className="-right-12 bottom-16" />
        </div>
      </div>
    </Section>
  );
}
