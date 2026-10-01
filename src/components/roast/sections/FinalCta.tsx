import Image from "next/image";
import { FireButton } from "../FireButton";
import { FlameVortex } from "../FlameVortex";
import { RevealText } from "../RevealText";
import { Section } from "../Section";
import peklo from "../assets/level-peklo.png";

/** Последний экран: «Угли прогреты». Огонь поднимается снизу, чёртик мешает в чане */
export function FinalCta() {
  return (
    <Section id="start" surface="color" className="flex min-h-[80svh] items-center py-24">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <FlameVortex mode="rise" fade scale={3.2} density={0.86} slot="final" />
      </div>
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-4 text-center md:px-6">
        <RevealText
          as="h2"
          className="type-display-hero"
          lines={[
            ["Угли ", { br: "mobile" }, "прогреты"],
            ["Кого ", { br: "mobile" }, { text: "жарим?", className: "tilt" }],
          ]}
        />
        <FireButton href="/create" className="mt-32 md:mt-40" cut="var(--color-orange)">
          Прожарить
        </FireButton>
      </div>
      <div className="absolute right-[3%] bottom-[6%] w-[min(24vw,300px)] max-md:hidden">
        <Image
          src={peklo}
          alt="Чёртик мешает смайлик в чане"
          sizes="300px"
          className="h-auto w-full animate-float transition-transform duration-300 [--float-r:-3deg] hover:scale-105"
        />
      </div>
    </Section>
  );
}
