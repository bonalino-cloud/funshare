"use client";

import { useState, type CSSProperties } from "react";
import { cx } from "@/components/cx";

/**
 * Аватар из Instagram: круг с ink-обводкой. Под картинкой всегда лежит розовый круг с первой
 * буквой ника: он виден, пока картинка грузится, и остаётся, если ссылки нет или CDN её не отдал.
 * Размер и кегль буквы задаёт `className` (или `style`).
 */
export function Avatar({
  username,
  url,
  className,
  style,
}: {
  username: string;
  url: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    // Буква и картинка в одной клетке сетки: картинка ложится поверх без позиционирования
    <div
      className={cx(
        "grid place-items-center overflow-hidden rounded-full border-[3px] border-ink bg-pink font-wide leading-none font-black text-ink",
        className,
      )}
      style={style}
    >
      <span className="[grid-area:1/1]">{username[0]?.toUpperCase()}</span>
      {url !== null && failed !== url && (
        // Ссылки на CDN Instagram с подписью и разными доменами: next/image тут не помощник
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
          className="size-full object-cover [grid-area:1/1]"
        />
      )}
    </div>
  );
}
