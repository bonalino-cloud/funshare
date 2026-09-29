import Image from "next/image";
import { Plus } from "../Icons";
import { Reveal } from "../Reveal";
import { Section, SectionHeading } from "../Section";
import extinguisher from "../assets/sticker-extinguisher.png";

const faq = [
  {
    q: "Это бесплатно?",
    a: "Поджог бесплатно, без регистрации и лимита на первый раз. Кострище и Пекло с картинками и видео, там будет цена. Скажем заранее, до кнопки.",
  },
  { q: "Друг увидит, что это я?", a: "Только если сам скажешь. В прожарке нет имени отправителя." },
  {
    q: "Вы заходите в мой аккаунт?",
    a: "Нет. Смотрим только то, что видно всем без входа. Закрытый профиль не откроем.",
  },
  { q: "А если обидно?", a: "Жми «Удалить», и ссылка перестаёт работать. Картинки стираем тоже." },
  {
    q: "Почему картинка не похожа на меня?",
    a: "Так и задумано. Рисуем персонажа по мотивам профиля, а не копируем лицо. Дипфейки не делаем.",
  },
  {
    q: "Можно прожарить не Instagram?",
    a: "Пока только его. Telegram-каналы и TikTok в планах, напиши, если очень надо.",
  },
];

/** Вопросы: аккордеон на details/summary — работает и без JS */
export function FaqSection() {
  return (
    <Section id="faq" surface="dark" className="py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 md:grid-cols-[1fr_1.6fr] md:px-6">
        <div className="relative">
          <SectionHeading label="Вопросы" lines={[["Спро"], ["сили?"]]} />
          <Image
            src={extinguisher}
            alt=""
            sizes="140px"
            className="mt-8 h-auto w-28 -rotate-12 transition-transform duration-300 hover:rotate-12 md:w-36"
          />
        </div>
        <div className="border-t-2 border-paper/20">
          {faq.map((f, i) => (
            <Reveal key={f.q} delay={i * 60}>
              <details className="group border-b-2 border-paper/20 [&_summary::-webkit-details-marker]:hidden">
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
