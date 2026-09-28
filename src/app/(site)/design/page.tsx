import type { Metadata } from "next";
import { Daisy } from "@/components/brand/Daisy";
import { ArrowUpRight, Circled, FlameEdge, Squiggle } from "@/components/brand/Doodles";
import { Flower } from "@/components/brand/Flower";
import { Marquee } from "@/components/brand/Marquee";
import { Sticker } from "@/components/brand/Sticker";
import { Block, type BlockTone } from "@/components/ui/Block";
import { Button } from "@/components/ui/Button";
import { LinkInput } from "@/components/ui/LinkInput";
import { Pill } from "@/components/ui/Pill";

export const metadata: Metadata = {
  title: "Funshare — дизайн-система",
  robots: { index: false },
};

const palette: Array<{ tone: BlockTone; name: string; hex: string; role: string }> = [
  { tone: "sun", name: "Sun", hex: "#F5D133", role: "Досье, главный CTA" },
  { tone: "violet", name: "Violet", hex: "#7C4DFF", role: "Прогнозы, стикеры" },
  { tone: "tomato", name: "Tomato", hex: "#E0463B", role: "Роаст, ошибки" },
  { tone: "cobalt", name: "Cobalt", hex: "#2152C4", role: "Прошлая жизнь" },
  { tone: "mint", name: "Mint", hex: "#3FA58F", role: "Совместимость" },
  { tone: "bubblegum", name: "Bubblegum", hex: "#F7A8E0", role: "Подчёркивания, акценты" },
  { tone: "lime", name: "Lime", hex: "#33D17A", role: "Ленты, успех" },
  { tone: "flame", name: "Flame", hex: "#FF7A1A", role: "Срочность, огонь" },
  { tone: "paper", name: "Paper", hex: "#F3EBDD", role: "Светлые блоки, текст" },
  { tone: "ink", name: "Ink", hex: "#141414", role: "Холст" },
];

const features: Array<{ accent: string; title: string; tag: string }> = [
  { accent: "sun", title: "Досье", tag: "Кто ты по версии ИИ" },
  { accent: "violet", title: "Прогноз", tag: "Что ждёт в 2027" },
  { accent: "tomato", title: "Роаст", tag: "Любя, но честно" },
  { accent: "cobalt", title: "Прошлая жизнь", tag: "Кем ты был до" },
];

function SectionTitle({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between border-b-2 border-ink-3 pb-3">
      <h2 className="type-condensed text-5xl">{children}</h2>
      <span className="type-eyebrow text-paper-dim">{n}</span>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <main data-accent="sun" className="mx-auto w-full max-w-6xl px-4 pt-8 pb-0 md:px-8">
      {/* Шапка в духе «MERSHE · SAIGON · PRESENTS» */}
      <header className="mb-8 flex items-center justify-between type-eyebrow">
        <span>Funshare</span>
        <span className="hidden sm:inline">Design system</span>
        <span>v1 · 2026</span>
      </header>

      {/* ── Витрина: так собирается мини-лендинг ── */}
      <section aria-label="Пример композиции" className="grid gap-4 md:grid-cols-12 md:gap-5">
        <Block tone="sun" className="overflow-visible md:col-span-7 md:row-span-2 md:min-h-[34rem]">
          <div className="flex items-start justify-between">
            <Pill tone="ink">
              <Flower className="size-3.5 text-sun" /> Новое
            </Pill>
            <span className="text-right type-eyebrow">
              Instagram → досье
              <br />
              за 60 секунд
            </span>
          </div>
          <h1 className="relative z-10 mt-10 type-display">
            Досье
            <br />
            на <Squiggle>тебя</Squiggle>
          </h1>
          <p className="relative z-10 mt-8 max-w-[19rem] type-body">
            Вставь ссылку на профиль — ИИ соберёт характер, суперсилу и прогноз на год. Поделись в
            сторис.
          </p>
          <div className="relative z-10 mt-8">
            <Button variant="ink">Сделать досье</Button>
          </div>
          <Daisy className="-mt-12 ml-auto block w-28 animate-wiggle sm:absolute sm:right-6 sm:bottom-8 sm:mt-0 sm:w-40 lg:right-16 lg:w-52" />
          <Sticker
            tone="violet"
            className="absolute -right-4 -bottom-10 z-20 md:-right-10 md:-bottom-12"
          />
        </Block>

        <Block tone="tomato" className="flex min-h-56 flex-col justify-between md:col-span-5">
          <div className="flex justify-between type-eyebrow">
            <Flower className="size-6" />
            <span className="text-right">
              Любя, но честно
              <br />
              18+ по юмору
            </span>
          </div>
          <h3 className="type-title">
            Роаст
            <br />
            профиля
          </h3>
        </Block>

        <Block tone="violet" className="flex min-h-56 flex-col justify-between md:col-span-5">
          <span className="type-eyebrow">Каждый январь</span>
          <h3 className="type-title">
            Прогноз <Circled>2027</Circled>
          </h3>
          <div className="flex gap-2">
            <Pill tone="paper">Любовь</Pill>
            <Pill tone="paper">Деньги</Pill>
            <Pill tone="paper">Путешествия</Pill>
          </div>
        </Block>

        <Block
          flush
          grain={false}
          tone="paper"
          className="grid overflow-hidden md:col-span-7 md:grid-cols-2"
        >
          <div className="grain bg-mint p-6 md:p-8">
            <h3 className="font-display text-5xl leading-[0.9] font-extrabold tracking-[-0.05em] lowercase">
              совмест-
              <br />
              имость
            </h3>
            <p className="mt-6 type-eyebrow">Два профиля — один вердикт</p>
          </div>
          <div className="relative grid min-h-48 place-items-center p-6">
            <Daisy mood="wow" className="w-28" />
            <span className="absolute top-5 right-5">
              <Flower className="size-7 text-ink" />
            </span>
          </div>
        </Block>

        <Block tone="paper" className="grid place-items-center md:col-span-5">
          <p className="text-center type-sticker text-5xl md:text-6xl">
            Дружба <Flower className="inline size-[0.7em] text-violet" /> тест
            <br />
            на 100%
          </p>
        </Block>
      </section>

      <Marquee
        className="-mx-4 mt-10 md:-mx-8"
        items={["Funshare", "2027", "Досье", "Прогноз", "Роаст", "Сторис"]}
      />

      {/* ── Цвета ── */}
      <section className="mt-16">
        <SectionTitle n="01">Цвета</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {palette.map((c) => (
            <Block
              key={c.name}
              flush
              tone={c.tone}
              className="flex min-h-40 flex-col justify-between p-5"
            >
              <span className="type-title text-2xl sm:text-3xl">{c.name}</span>
              <span className="type-eyebrow">
                {c.hex}
                <br />
                <span className="font-semibold normal-case opacity-80">{c.role}</span>
              </span>
            </Block>
          ))}
        </div>
      </section>

      {/* ── Шрифты ── */}
      <section className="mt-16">
        <SectionTitle n="02">Шрифты</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <Block tone="ink" className="md:col-span-2">
            <span className="type-eyebrow text-paper-dim">Inter Tight 800 · type-display</span>
            <p className="mt-4 type-display">Кто ты, @anna?</p>
          </Block>
          <Block tone="ink">
            <span className="type-eyebrow text-paper-dim">
              Sofia Sans Extra Condensed 900 · type-condensed
            </span>
            <p className="mt-4 type-condensed">Прогноз · Любовь · Деньги</p>
          </Block>
          <Block tone="ink">
            <span className="type-eyebrow text-paper-dim">Dela Gothic One · type-sticker</span>
            <p className="mt-4 type-sticker text-5xl">Суперсила!</p>
          </Block>
          <Block tone="ink" className="md:col-span-2">
            <span className="type-eyebrow text-paper-dim">Inter Tight 500 · type-body</span>
            <p className="mt-4 max-w-2xl type-body">
              Ты из тех, кто фотографирует кофе раньше, чем пьёт его. В 2027 году звёзды советуют
              меньше сторис с закатами и больше спонтанных поездок — одна из них изменит твой год.
            </p>
          </Block>
        </div>
      </section>

      {/* ── Компоненты ── */}
      <section className="mt-16">
        <SectionTitle n="03">Компоненты</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <Block tone="ink" className="flex flex-wrap items-center gap-4">
            <Button>В сторис</Button>
            <Button variant="paper">Скопировать ссылку</Button>
            <Button variant="ghost" icon={null}>
              Сделать ещё
            </Button>
          </Block>
          <Block tone="ink" className="flex flex-wrap items-center gap-2">
            <Pill tone="sun">Для себя</Pill>
            <Pill tone="paper">Для друга</Pill>
            <Pill tone="violet">2027</Pill>
            <Pill tone="lime">Готово</Pill>
            <Pill tone="tomato">Профиль закрыт</Pill>
          </Block>
          <Block tone="ink" className="md:col-span-2">
            <LinkInput placeholder="instagram.com/username" />
            <LinkInput
              className="mt-6"
              defaultValue="instagram.com/closed.account"
              error="Этот профиль закрыт — попробуй открытый"
            />
          </Block>
          <Block tone="ink" className="flex items-center justify-around gap-4">
            <Sticker tone="violet" />
            <Sticker tone="paper" />
            <Sticker tone="sun" spin={false} />
          </Block>
          <Block tone="ink" className="flex flex-wrap items-center justify-around gap-6">
            <span className="type-title text-4xl">
              <Squiggle>Змейка</Squiggle>
            </span>
            <span className="type-title text-4xl">
              <Circled>Обводка</Circled>
            </span>
            <Daisy className="w-20" />
          </Block>
        </div>
      </section>

      {/* ── Мини-лендинги: один макет, свой акцент ── */}
      <section className="mt-16">
        <SectionTitle n="04">Акцент фичи</SectionTitle>
        <p className="mb-6 max-w-2xl type-body text-paper-dim">
          Каждый мини-лендинг берёт один ведущий цвет через{" "}
          <code className="text-paper">data-accent</code>. Шрифты, радиусы, стикеры и сетка — общие.
          Так все фичи выглядят одной семьёй.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {features.map((f) => (
            <div key={f.accent} data-accent={f.accent}>
              <Block tone="accent" className="flex min-h-72 flex-col justify-between">
                <Flower className="size-8" />
                <div>
                  <h3 className="type-title text-4xl">{f.title}</h3>
                  <p className="mt-2 type-eyebrow opacity-80">{f.tag}</p>
                </div>
              </Block>
            </div>
          ))}
        </div>
      </section>

      {/* ── Навигация в стиле Jiva ── */}
      <section className="mt-16">
        <SectionTitle n="05">Меню-список</SectionTitle>
        <nav aria-label="Пример меню">
          {["Досье", "Прогноз", "Роаст", "Совместимость"].map((item, i) => (
            <a
              key={item}
              href="#"
              className="group flex items-center justify-between border-b-2 border-ink-3 py-3 transition-colors hover:text-sun"
            >
              <span className="flex items-center gap-4 type-condensed text-6xl">
                <span className={i === 0 ? "rounded-tile bg-bubblegum px-3 text-ink" : ""}>
                  {item}
                </span>
              </span>
              <ArrowUpRight className="size-8 transition-transform duration-300 ease-bounce group-hover:rotate-45" />
            </a>
          ))}
        </nav>
      </section>

      <FlameEdge className="-mx-4 mt-20 w-[calc(100%+2rem)] text-flame md:-mx-8 md:w-[calc(100%+4rem)]" />
      <footer className="-mx-4 flex items-center justify-between bg-flame px-4 py-6 type-eyebrow text-ink md:-mx-8 md:px-8">
        <span className="flex items-center gap-2">
          <Flower className="size-4" /> <Flower className="size-4" /> <Flower className="size-4" />
        </span>
        <span>Funshare · сделано с любовью</span>
      </footer>
    </main>
  );
}
