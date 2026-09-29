import { Asterisk } from "@/components/brand/Asterisk";
import { Cross } from "../Icons";
import { FlameVortex } from "../FlameVortex";
import { Reveal } from "../Reveal";
import { Section } from "../Section";
import { RevealText } from "../RevealText";

const never = [
  "Внешность, вес, здоровье",
  "Национальность, религию, политику",
  "Ориентацию, семью, деньги",
];
const data = [
  "Только открытые профили. Закрытый значит закрытый",
  "Маленьких не обижаем",
  "Картинки рисуем, а не копируем лицо",
  "Передумал: жми «Удалить», и прожарки нет",
  "Сырое храним 30 дней, потом стираем",
];

/** «Жарим, но не сжигаем дотла»: цветной этаж с паттерном пламени, правила на плотных карточках */
export function RulesSection() {
  return (
    <Section id="rules" surface="color" className="py-20 md:py-28">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 [translate:0_calc(var(--sy,0)*0.2px)]"
      >
        <FlameVortex mode="rise" scale={1.3} />
      </div>
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="inline-block -rotate-2 rounded-lg border-2 border-ink bg-paper px-5 py-4 text-ink shadow-offset transition-transform duration-200 hover:rotate-0 md:px-8 md:py-6">
          <RevealText
            as="h2"
            className="type-cond-hero"
            step={26}
            lines={[
              ["Жарим, но"],
              ["не сжигаем ", { br: "mobile" }, { text: "дотла", className: "tilt text-red" }],
            ]}
          />
        </div>

        <div className="mt-10 grid gap-5 md:mt-14 md:grid-cols-2 md:gap-6">
          <Reveal>
            <div className="h-full rounded-md border-2 border-white bg-ink p-5 text-paper md:p-7">
              <h3 className="type-display-m">Не трогаем. Никогда</h3>
              <ul className="mt-5 space-y-3">
                {never.map((t) => (
                  <li
                    key={t}
                    className="group flex items-center gap-3 type-lead transition-transform duration-200 hover:translate-x-1"
                  >
                    <Cross className="size-5 shrink-0 text-red transition-transform duration-200 group-hover:rotate-90" />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t-2 border-dashed border-paper/30 pt-4 type-body text-paper/70">
                Даже на «Жёстко». Жёстко это про привычки, не про человека.
              </p>
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
