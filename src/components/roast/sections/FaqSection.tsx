import { Plus } from "../Icons";
import { Reveal } from "../Reveal";
import { RevealText } from "../RevealText";
import { Section } from "../Section";

const faq = [
  {
    q: "Это бесплатно?",
    a: "Поджог бесплатно один раз, без регистрации и лимита на первый раз. Остальное топится дровами, а дрова платные.",
  },
  { q: "Друг увидит, что это я?", a: "Только если сам скажешь. В прожарке нет имени отправителя." },
  {
    q: "Вы заходите в мой аккаунт?",
    a: "Нет. Смотрим только то, что видно всем без входа. Закрытый профиль не откроем.",
  },
  {
    q: "А если обидно?",
    a: "Всегда можно удалить, но мы против оскорблений и шуток из стоп-листа.",
  },
  {
    q: "Почему картинка не похожа на меня?",
    a: "Так и задумано. Рисуем персонажа по мотивам профиля, а не копируем лицо. Дипфейки не в тренде.",
  },
  {
    q: "Можно прожарить не Instagram?",
    a: "Пока только его. Telegram-каналы и TikTok пока только в планах.",
  },
];

/** «Вопросы? Ответы!»: заголовок на всю ширину, ниже аккордеон на details/summary — работает и без JS */
export function FaqSection() {
  return (
    <Section id="faq" surface="dark" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <RevealText
          as="h2"
          className="type-display-section"
          step={26}
          jitter
          lines={[["Вопросы?"], [{ text: "Ответы!", className: "text-[1.45em]" }]]}
        />
        <div className="mt-10 md:mt-14">
          {faq.map((f, i) => (
            <Reveal key={f.q} delay={i * 60} className="border-b-2 border-paper/20 last:border-b-0">
              <details className="group [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 transition-colors duration-200 hover:text-orange">
                  <span className="type-cond-m md:text-4xl">{f.q}</span>
                  <span className="grid size-10 shrink-0 place-items-center rounded-sm border-2 border-paper transition-transform duration-200 group-open:rotate-45 group-open:bg-orange group-open:text-ink">
                    <Plus className="size-5" />
                  </span>
                </summary>
                <p className="max-w-[56ch] pb-6 type-lead text-[color:var(--muted)]">{f.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
