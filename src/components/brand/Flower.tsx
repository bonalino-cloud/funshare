import type { SVGProps } from "react";

/**
 * Фирменный знак ✱ — цветок из 8 круглых лепестков (как в рефе MERSHE).
 * Цвет берёт из currentColor.
 */
export function Flower(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" {...props}>
      <g fill="currentColor">
        {Array.from({ length: 8 }, (_, i) => (
          <ellipse key={i} cx="50" cy="24" rx="12" ry="22" transform={`rotate(${i * 45} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="14" />
      </g>
    </svg>
  );
}
