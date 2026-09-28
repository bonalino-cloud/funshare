import type { SVGProps } from "react";

type Mood = "smile" | "wink" | "wow";

/**
 * Маскот-ромашка с рожицей (реф BEER BÔNG): белые лепестки с жирным контуром,
 * жёлтая серединка. Используется как иллюстрация-заглушка и декор.
 */
export function Daisy({ mood = "smile", ...props }: SVGProps<SVGSVGElement> & { mood?: Mood }) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" {...props}>
      <g stroke="#141414" strokeWidth="6" strokeLinejoin="round">
        {Array.from({ length: 9 }, (_, i) => (
          <ellipse
            key={i}
            cx="100"
            cy="48"
            rx="22"
            ry="44"
            fill="#fbf7ef"
            transform={`rotate(${i * 40} 100 100)`}
          />
        ))}
        <circle cx="100" cy="100" r="40" fill="#f5d133" />
      </g>
      <g stroke="#141414" strokeWidth="6" strokeLinecap="round" fill="none">
        {mood === "wink" ? (
          <>
            <path d="M80 94 q6 -8 12 0" />
            <path d="M108 90 l12 0" />
          </>
        ) : mood === "wow" ? (
          <>
            <circle cx="86" cy="92" r="3" fill="#141414" />
            <circle cx="114" cy="92" r="3" fill="#141414" />
          </>
        ) : (
          <>
            <path d="M82 88 v8" />
            <path d="M118 88 v8" />
          </>
        )}
        {mood === "wow" ? (
          <ellipse cx="100" cy="116" rx="8" ry="10" fill="#141414" />
        ) : (
          <path d="M80 110 q20 20 40 0" />
        )}
      </g>
    </svg>
  );
}
