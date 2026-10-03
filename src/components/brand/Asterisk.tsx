import type { SVGProps } from "react";

/**
 * Логомарк ✱ — шестилепестковый цветок-астериск (DESIGN.md §6.1).
 * Логотип, буллеты, разделители тикеров, центр стикер-бейджа. Цвет — currentColor.
 */
export function Asterisk(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" {...props}>
      <g fill="currentColor">
        {Array.from({ length: 6 }, (_, i) => (
          <ellipse key={i} cx="50" cy="26" rx="13" ry="25" transform={`rotate(${i * 60} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="13" />
      </g>
    </svg>
  );
}
