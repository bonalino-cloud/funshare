import Image, { type StaticImageData } from "next/image";
import { cx } from "@/components/cx";
import { cardTones, type CardTone } from "@/components/ui/Card";
import { Flames, flameOn } from "../Flames";
import { Chili } from "../Icons";
import { Reveal } from "../Reveal";
import { Section, SectionHeading } from "../Section";
import rare from "@/components/create/assets/level-rare.png";
import medium from "@/components/create/assets/level-medium.png";
import well from "@/components/create/assets/level-well.png";

/** Три степени прожарки (tone-of-voice.md «Уровни для прожарки») */
const degrees: {
  name: string;
  heat: number;
  tone: CardTone;
  img: StaticImageData;
  text: string;
  adult?: boolean;
}[] = [
  {
    name: "Rare",
    heat: 1,
    tone: "yellow",
    img: rare,
    text: "Мягко. Подколы, которые можно показать маме.",
  },
  {
    name: "Medium",
    heat: 2,
    tone: "paper",
    img: medium,
    text: "Средне. Друг, который знает тебя десять лет: точно, с иронией, без мата.",
  },
  {
    name: "Well done",
    heat: 3,
    tone: "red",
    img: well,
    text: "Жёстко. Роаст-баттл: мат допустим, достаётся и внешности.",
    adult: true,
  },
];

/** «Три степени прожарки»: светлый этаж, карточки с чёртиком, огонь при наведении, бейдж 18+ у Well done */
export function DegreesSection() {
  return (
    <Section id="degrees" surface="light" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <SectionHeading lines={[["Три степени"], [{ text: "прожа", className: "tilt" }, "рки"]]} />
        <div className="mt-12 grid gap-5 md:mt-16 md:grid-cols-3">
          {degrees.map((d, i) => (
            <Reveal key={d.name} delay={i * 90}>
              <div
                className={cx(
                  "group/flames relative h-full min-h-56 rounded-lg border-2 border-ink p-5 pr-32 shadow-offset transition-transform duration-200 ease-[var(--ease-poster)] hover:-translate-y-1 hover:-rotate-1 md:p-6 md:pr-36",
                  cardTones[d.tone],
                )}
              >
                {/* Огонь и иллюстрация режутся краем карточки, бейдж выходит за край */}
                <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
                  <Flames
                    trigger="hover"
                    particle="sm"
                    {...flameOn(d.tone)}
                    className="inset-x-0 bottom-0 h-28 [--rise:-100px]"
                  />
                  <Image
                    src={d.img}
                    alt=""
                    sizes="200px"
                    className="absolute -right-8 -bottom-10 h-48 w-auto animate-float transition-transform duration-300 ease-[var(--ease-poster)] [--float-r:2deg] group-hover/flames:scale-110 group-hover/flames:-rotate-6"
                    style={{ animationDelay: `${i * 0.5}s` }}
                  />
                </span>
                {d.adult && (
                  <span className="absolute -top-3 -right-3 rotate-6 rounded-sm border-2 border-ink bg-pink px-2 py-1 type-label text-ink transition-transform duration-200 ease-[var(--ease-poster)] group-hover/flames:scale-110 group-hover/flames:rotate-12">
                    18+
                  </span>
                )}
                <span className="relative flex -space-x-2.5">
                  {Array.from({ length: d.heat }, (_, k) => (
                    <Chili
                      key={k}
                      className="size-7 transition-transform duration-200 group-hover/flames:-rotate-12"
                      style={{ transitionDelay: `${k * 40}ms` }}
                    />
                  ))}
                </span>
                <span className="relative mt-2 block type-cond-l whitespace-nowrap">{d.name}</span>
                <p className="relative mt-3 max-w-[22ch] type-body font-semibold">{d.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
