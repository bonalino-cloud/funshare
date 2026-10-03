import Link from "next/link";
import type { ReactNode } from "react";

const cls =
  "self-center px-3 py-2 type-label text-sm text-paper/50 transition-colors duration-150 hover:text-white focus-visible:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink";

/** Тихое действие под главной кнопкой: только текст, полупрозрачный, при наведении белый. */
export function QuietLink(
  props: { children: ReactNode } & ({ href: string } | { onClick: () => void }),
) {
  if ("href" in props) {
    return (
      <Link href={props.href} className={cls}>
        {props.children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={props.onClick} className={cls}>
      {props.children}
    </button>
  );
}
