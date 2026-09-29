import Image, { type StaticImageData } from "next/image";
import { cx } from "@/components/cx";
import { cardTones, type CardTone } from "@/components/ui/Card";
import { Flames, flameOn } from "../Flames";
import { Reveal } from "../Reveal";
import { Section, SectionHeading } from "../Section";
import dice from "../assets/when-dice.png";
import cake from "../assets/when-cake.png";
import angry from "../assets/when-angry.png";
import robot from "../assets/when-robot.png";
import chat from "../assets/when-chat.png";

const cases: { title: string; text: string; img: StaticImageData; tone: CardTone }[] = [
  {
    title: "В рандомный день",
    text: "Рандомное время. Без повода. Так даже лучше.",
    img: dice,
    tone: "yellow",
  },
  {
    title: "На ДР другу",
    text: "Которого особенно любишь. Вместо «с др, бро».",
    img: cake,
    tone: "cobalt",
  },
  {
    title: "Когда кто-то взбесил",
    text: "А ответить нужно красиво — с огоньком!",
    img: angry,
    tone: "red",
  },
  {
    title: "Что ИИ думает обо мне",
    text: "Самоирония в сторис заходит лучше селфи.",
    img: robot,
    tone: "teal",
  },
  {
    title: "В общий чат",
    text: "Есть кто-то в прицеле? Тащи его на решётку — будет жарко.",
    img: chat,
    tone: "violet",
  },
];

/** «Когда заходит»: шесть поводов, карточки загораются снизу при наведении */
export function WhenSection() {
  return (
    <Section id="when" surface="light" className="pt-28 pb-20 md:pt-36 md:pb-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <SectionHeading
          lines={[["Когда ", { br: "mobile" }, { text: "заходит", decor: "circled" }]]}
        />
        <div className="mt-14 grid gap-x-5 gap-y-10 sm:grid-cols-2 md:mt-20 lg:grid-cols-3">
          {cases.map((c, i) => (
            <Reveal key={c.title} delay={(i % 3) * 90}>
              <article
                className={cx(
                  "group/flames relative flex min-h-60 flex-col justify-end overflow-visible rounded-lg p-5 transition-transform duration-200 ease-[var(--ease-poster)] hover:-translate-y-2 md:min-h-72 md:p-6",
                  i % 2 ? "hover:rotate-1" : "hover:-rotate-1",
                  cardTones[c.tone],
                )}
              >
                {/* Огонь поднимается от нижнего края внутри карточки */}
                <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                  <Flames
                    trigger="hover"
                    particle="sm"
                    {...flameOn(c.tone)}
                    className="inset-x-0 bottom-0 h-32 [--rise:-110px]"
                  />
                </span>
                <Image
                  src={c.img}
                  alt=""
                  sizes="160px"
                  className="absolute -top-8 right-3 h-28 w-auto rotate-6 transition-transform duration-300 ease-[var(--ease-poster)] group-hover/flames:scale-110 group-hover/flames:-rotate-6 md:h-32"
                />
                <h3 className="relative max-w-[12ch] type-cond-l">{c.title}</h3>
                <p className="relative mt-3 max-w-[30ch] type-body">{c.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
