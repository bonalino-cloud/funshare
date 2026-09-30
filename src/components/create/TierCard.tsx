import Image, { type StaticImageData } from "next/image";
import type { ReactNode } from "react";
import { ArrowNE } from "@/components/brand/Doodles";
import { cx } from "@/components/cx";
import { cardTones, type CardTone } from "@/components/ui/Card";

/**
 * Карточка-кнопка тарифа или степени: текст слева, маскот в правом нижнем углу,
 * нажимается целиком и ведёт дальше. Стрелка ↗ в углу как подсказка; вместо неё может стоять тег.
 */
export function TierCard({
  tone,
  title,
  image,
  imageAlt = "",
  corner,
  children,
  footer,
  onClick,
  className,
}: {
  tone: CardTone;
  title: ReactNode;
  image: StaticImageData;
  imageAlt?: string;
  /** Правый верхний угол: тег вместо стрелки */
  corner?: ReactNode;
  children?: ReactNode;
  /** Нижний ряд слева: цена */
  footer?: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "group grain relative flex min-h-[120px] flex-col overflow-hidden rounded-lg p-7 pr-[44%] text-left",
        "transition-transform duration-200 ease-[var(--ease-poster)] hover:scale-[1.03] active:scale-[0.98]",
        "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-pink",
        cardTones[tone],
        className,
      )}
    >
      <span className="absolute top-4 right-4 z-10">
        {corner ?? (
          <ArrowNE
            strokeWidth="3"
            className="size-6 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        )}
      </span>
      {title}
      {children}
      {footer && <span className="mt-auto block pt-2.5">{footer}</span>}
      <Image
        src={image}
        alt={imageAlt}
        sizes="200px"
        className="pointer-events-none absolute right-0 bottom-0 z-0 h-[86%] w-auto max-w-[46%] translate-x-[4%] translate-y-[6%] object-contain object-right-bottom"
      />
    </button>
  );
}

/** Название на карточке: Unbounded, капс */
export function TierName({ children }: { children: ReactNode }) {
  return (
    <span className="relative z-10 block font-wide text-[26px] leading-[0.9] font-black tracking-tight uppercase">
      {children}
    </span>
  );
}

/** Список «что получишь», каждая строка с плюсом */
export function TierList({ items }: { items: string[] }) {
  return (
    <ul className="relative z-10 mt-2 flex flex-col gap-0.5 type-body font-semibold">
      {items.map((item) => (
        <li key={item} className="relative pl-4">
          <span aria-hidden="true" className="absolute left-0 font-extrabold">
            +
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}
