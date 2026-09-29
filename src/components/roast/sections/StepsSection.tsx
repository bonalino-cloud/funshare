import Image from "next/image";
import { DonenessMeter, Typewriter } from "../Live";
import { Reveal } from "../Reveal";
import { Section, SectionHeading } from "../Section";
import { Sticker } from "../Sticker";
import thermo from "../assets/sticker-thermo.png";
import flame from "../assets/sticker-flame.png";
import pan from "../assets/sticker-pan.png";
import share from "../assets/step-share.png";

/** «Как делается»: три шага, в каждом — живая мини-сцена */
export function StepsSection() {
  return (
    <Section id="how" surface="dark" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <SectionHeading
          label="Три шага"
          lines={[["Как ", { br: "mobile" }, { text: "дела", className: "tilt" }, "ется"]]}
        />

        <div className="mt-12 grid gap-5 md:mt-16 md:grid-cols-3 md:gap-6">
          <Step
            n="01"
            title="Кидаешь ссылку"
            text="Свою или друга. Только открытые профили."
            delay={0}
          >
            <div className="mt-6 flex h-12 items-center gap-2 rounded-sm border-2 border-paper bg-paper px-3 text-ink">
              <span className="font-wide text-lg font-extrabold text-ink/40">@</span>
              <Typewriter text="anya.travels" className="type-body font-semibold" />
            </div>
          </Step>

          <Step
            n="02"
            title="Несколько минут магии"
            text="Жарим жертву со всех сторон до стадии Well done!"
            delay={120}
            className="md:-translate-y-6"
          >
            <DonenessMeter className="mt-6" />
            <Sticker src={thermo} width={70} depth={1.4} rotate={16} className="-top-10 -right-4" />
          </Step>

          <Step
            n="03"
            title="Share"
            text="Делишься готовым артефактом. Осторожно, горячо!"
            delay={240}
          >
            <Image
              src={share}
              alt="Палец тянется к кнопке «Отправить», во второй руке бомба с горящим письмом"
              sizes="(max-width: 768px) 80vw, 320px"
              className="mt-6 h-auto w-full -rotate-2 transition-transform duration-300 ease-[var(--ease-poster)] hover:scale-105 hover:rotate-1"
            />
            <Sticker src={flame} width={64} depth={1.8} rotate={-12} className="-top-8 -right-3" />
          </Step>
        </div>
      </div>
      <Sticker
        src={pan}
        width={120}
        depth={2}
        rotate={-8}
        className="top-16 right-[6%] max-md:hidden"
      />
    </Section>
  );
}

function Step({
  n,
  title,
  text,
  delay,
  className,
  children,
}: {
  n: string;
  title: string;
  text: string;
  delay: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Reveal delay={delay} className={className}>
      <article className="group/flames relative h-full rounded-md border-2 border-white bg-ink p-5 transition-transform duration-200 hover:-translate-y-1 hover:-rotate-1 md:p-6">
        <p className="type-cond-xl text-orange transition-transform duration-300 group-hover/flames:-rotate-6">
          {n}
        </p>
        <h3 className="mt-3 type-display-m">{title}</h3>
        <p className="mt-3 type-body text-[color:var(--muted)]">{text}</p>
        {children}
      </article>
    </Reveal>
  );
}
