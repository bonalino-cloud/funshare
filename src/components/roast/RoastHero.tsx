import Image from "next/image";
import { cx } from "@/components/cx";
import { DoodleArrow } from "@/components/brand/Doodles";
import { Marquee } from "@/components/brand/Marquee";
import { FireButton } from "./FireButton";
import { FlameVortex } from "./FlameVortex";
import { ParallaxScope } from "./ParallaxScope";
import { RevealText } from "./RevealText";
import { RoastNav } from "./RoastNav";
import { Stamp } from "./Stamp";
import { Sticker } from "./Sticker";
import imp from "./assets/imp-chef.png";
import chili from "./assets/sticker-chili.png";
import extinguisher from "./assets/sticker-extinguisher.png";
import flame from "./assets/sticker-flame.png";
import match from "./assets/sticker-match.png";
import pan from "./assets/sticker-pan.png";
import thermo from "./assets/sticker-thermo.png";

export type HeroSurface = "dark" | "light" | "color";

const tickerSticker = (src: typeof chili) => (
  <Image src={src} alt="" className="h-9 w-auto md:h-14" sizes="84px" />
);

/**
 * Hero мини-лендинга «Прожарка». Водоворот пламени на фоне, окно под заголовок,
 * чёртик-повар, стикеры, которые можно таскать, и две наклонные ленты внизу.
 */
export function RoastHero({ surface = "dark" }: { surface?: HeroSurface }) {
  return (
    <ParallaxScope
      data-surface={surface}
      className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-surface text-on-surface"
    >
      {/* Фон: водоворот уезжает медленнее контента */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 [translate:0_calc(var(--sy,0)*0.35px)]"
      >
        <FlameVortex />
        <div className="grain pointer-events-none absolute inset-0" />
      </div>

      <RoastNav />

      {/* Стикеры в зоне огня */}
      <div className="pointer-events-none absolute inset-0 z-10 [&>*]:pointer-events-auto">
        <Sticker
          src={chili}
          width={150}
          depth={1.4}
          rotate={-14}
          priority
          className="top-[13%] left-[4%] max-md:hidden"
        />
        <Sticker
          src={pan}
          width={170}
          depth={0.9}
          rotate={10}
          className="top-[12%] right-[5%] max-md:hidden"
        />
        <Sticker
          src={match}
          width={110}
          depth={1.8}
          rotate={24}
          className="bottom-[22%] left-[9%] max-md:hidden"
        />
        <Sticker
          src={thermo}
          width={78}
          depth={1.2}
          rotate={-18}
          className="top-[44%] left-[2%] max-lg:hidden"
        />
        <Sticker
          src={flame}
          width={96}
          depth={2.2}
          rotate={12}
          className="top-[40%] right-[3%] max-md:top-auto max-md:right-[-4%] max-md:bottom-[38%] max-md:scale-[0.55] lg:hidden"
        />
        <Sticker
          src={extinguisher}
          width={120}
          depth={1.1}
          rotate={-10}
          className="right-[27%] bottom-[20%] max-lg:hidden"
        />
      </div>

      {/* Контент в окне водоворота */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 [translate:calc(var(--mx,0)*-6px)_calc(var(--my,0)*-4px+var(--sy,0)*0.12px)] flex-col items-center justify-center px-4 pt-10 pb-48 text-center md:pb-44">
        <p className="mb-5 inline-flex items-center gap-2 rounded-sm border-2 border-ink bg-paper px-3 py-1.5 type-label text-ink shadow-offset transition-transform duration-200 hover:-rotate-3">
          Instagram
          <svg
            viewBox="0 0 24 12"
            className="h-3 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <path d="M1 6h20M16 1l5 5-5 5" />
          </svg>
          прожарка
        </p>

        <RevealText
          as="h1"
          className="type-display-hero"
          delay={150}
          lines={[
            ["ПРОЖА", { text: "РЬ", className: "tilt" }],
            [{ text: "СЕБЯ.", decor: "squiggle" }],
            ["ИЛИ ", { text: "ДРУГА", decor: "circled" }],
          ]}
        />

        <p className="mt-6 max-w-[30ch] type-lead text-[color:var(--muted)] md:max-w-[36ch]">
          Кидай ссылку. ИИ прочитает сторис и выдаст роаст, которым не стыдно поделиться. Ну, почти.
        </p>

        <div className="relative mt-16 md:mt-20">
          <FireButton type="button">Прожарить</FireButton>
          {/* Рукописная подсказка со стрелкой */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-full mr-3 hidden -translate-y-full items-end gap-1 md:flex"
          >
            <span className="tilt -rotate-6 font-cond text-3xl font-bold whitespace-nowrap text-on-surface uppercase">
              не бойся, <br /> почти не больно
            </span>
            <DoodleArrow className="mb-[-28px] size-24 text-flame-a" />
          </div>
        </div>

        <p className="mt-6 type-meta text-[color:var(--muted)]">
          Поджог бесплатно · Только открытые профили · Пара минут
        </p>
      </div>

      {/* Чёртик-повар со штампом на углу */}
      <div className="absolute right-[2%] bottom-[12%] z-10 w-[min(22vw,300px)] [translate:calc(var(--mx,0)*26px)_calc(var(--my,0)*18px+var(--sy,0)*-0.18px)] max-md:relative max-md:right-auto max-md:bottom-auto max-md:mx-auto max-md:-mt-28 max-md:mb-28 max-md:w-[62vw]">
        <div className="group/imp relative animate-float [--float-r:3deg]">
          <Image
            src={imp}
            alt="Чёртик-повар жарит смайлик на вилке"
            priority
            sizes="(max-width: 768px) 62vw, 340px"
            className="h-auto w-full transition-transform duration-300 ease-[var(--ease-poster)] group-hover/imp:scale-105 group-hover/imp:-rotate-6"
          />
          <span className="pointer-events-none absolute -top-2 left-[58%] origin-bottom-left scale-0 rounded-md border-2 border-ink bg-paper px-3 py-2 font-cond text-2xl font-bold whitespace-nowrap text-ink uppercase shadow-offset transition-transform duration-200 ease-[var(--ease-poster)] group-hover/imp:scale-100">
            Кого жарим?
          </span>
          <Stamp
            text="Осторожно ✱ огнеопасно ✱ "
            className="absolute -top-6 -left-8 w-24 md:-left-12 md:w-32"
          />
        </div>
      </div>

      {/* Две наклонные ленты крест-накрест */}
      <div className="absolute inset-x-[-5%] bottom-8 z-20 md:bottom-12">
        <Marquee
          tone="yellow"
          tilt={2.5}
          reverse
          className="absolute inset-x-0 top-0 border-y-2 border-ink opacity-95"
          items={["Прожарка", "Бесплатно", "Без обид", "Ответка"]}
        />
        <Marquee
          tone={surface === "color" ? "paper" : "red"}
          tilt={-3}
          size="lg"
          className={cx("relative border-y-2 border-ink")}
          items={[
            "Осторожно",
            tickerSticker(chili),
            "Огнеопасно",
            tickerSticker(match),
            "Well done",
            tickerSticker(flame),
            "Жарим с любовью",
            tickerSticker(pan),
          ]}
        />
      </div>
    </ParallaxScope>
  );
}
