import { Asterisk } from "@/components/brand/Asterisk";
import { Cross } from "../Icons";
import { FlameVortex } from "../FlameVortex";
import { Reveal } from "../Reveal";
import { Section } from "../Section";
import { Sticker } from "../Sticker";
import snowflake from "../assets/sticker-snowflake.png";
import { RevealText } from "../RevealText";

const never = [
  "Семью и здоровье",
  "Национальность, религию, политику",
  "Ориентацию",
];
const data = [
  "Только открытые профили. Закрытый значит закрытый",
  "Маленьких не обижаем",
  "Лицо не копируем, а срисовываем",
  "Удалить прожарку можно в любое время",
  "Черновик какое-то время храним, потом сжигаем",
];

/** «Жарим, но не сжигаем дотла»: цветной этаж с паттерном пламени, правила на плотных карточках */
export function RulesSection() {
  return (
    <Section id="rules" surface="color" className="py-20 md:py-28">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <FlameVortex mode="rise" scale={1.3} slot="rules" />
      </div>
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="inline-block -rotate-2 rounded-lg border-2 border-ink bg-paper px-5 py-4 text-ink shadow-offset transition-transform duration-200 hover:rotate-0 md:px-8 md:py-6">
          <RevealText
            as="h2"
            className="type-display-section"
            step={26}
            jitter
            lines={[
              ["Жарим, но"],
              ["не сжигаем ", { br: "mobile" }, { text: "дотла", className: "tilt text-red" }],
            ]}
          />
        </div>

        <div className="mt-10 grid gap-5 md:mt-14 md:grid-cols-2 md:gap-6">
          <Reveal>
            <div className="relative h-full rounded-md border-2 border-white bg-ink p-5 text-paper md:p-7">
              {/* Холодная голова: сюда не жарим */}
              <Sticker
                src={snowflake}
                width={120}
                depth={1.6}
                rotate={12}
                className="-top-14 -right-6 z-10 max-md:scale-75"
              />
              <h3 className="type-display-m">Не трогаем. Никогда</h3>
              <ul className="mt-5 space-y-3">
                {never.map((t) => (
                  <li
                    key={t}
                    className="group flex items-center gap-3 type-lead transition-transform duration-200 hover:translate-x-1"
                  >
                    <Cross className="size-7 shrink-0 -rotate-6 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[84deg]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="h-full rounded-md border-2 border-ink bg-paper p-5 text-ink shadow-offset md:p-7">
              <h3 className="type-display-m">С данными так</h3>
              <ul className="mt-5 space-y-3">
                {data.map((t) => (
                  <li
                    key={t}
                    className="group flex items-start gap-3 type-body font-semibold transition-transform duration-200 hover:translate-x-1"
                  >
                    <Asterisk className="mt-0.5 size-4 shrink-0 text-red transition-transform duration-500 group-hover:rotate-[120deg]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
