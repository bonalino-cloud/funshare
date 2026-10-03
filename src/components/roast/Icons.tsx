import type { SVGProps } from "react";

/**
 * Иконки лендинга вместо эмодзи (DESIGN.md §10: эмодзи запрещены).
 * Толстый ink-контур, плоская заливка из палитры.
 */

type P = SVGProps<SVGSVGElement>;
const base = {
  viewBox: "0 0 48 48",
  "aria-hidden": true,
  strokeWidth: 3,
  stroke: "#111111",
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};

/** Перчик — уровень остроты сборки */
export function Chili(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M30 10c4-5 9-4 10-1" fill="none" />
      <path
        d="M27 13c6-1 10 3 9 9-1 9-10 19-26 20-3 0-3-3 0-4 9-3 13-10 14-17 0-4 0-7 3-8z"
        fill="#C9302C"
      />
      <path d="M26 13c2-3 6-4 9-2l-2 4c-2-1-5-1-7-2z" fill="#3B9B8B" />
      <path d="M29 19c1 3 0 6-2 9" stroke="#EDE0CF" fill="none" />
    </svg>
  );
}

export function Suitcase(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="16" width="30" height="24" rx="4" fill="#F4D21B" />
      <path d="M18 16v-5h12v5M9 26h30" fill="none" />
      <path d="M17 40v3M31 40v3" />
    </svg>
  );
}

export function Cup(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M9 20h24v8a12 12 0 0 1-24 0z" fill="#EDE0CF" />
      <path d="M33 23h3a5 5 0 0 1 0 10h-4" fill="none" />
      <path d="M17 8c-2 3 2 5 0 8M24 8c-2 3 2 5 0 8" fill="none" />
    </svg>
  );
}

export function Sunset(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M10 32a14 14 0 0 1 28 0z" fill="#F5871F" />
      <path d="M5 32h38M9 38h30M15 43h18M24 8v5M11 13l3 4M37 13l-3 4" fill="none" />
    </svg>
  );
}

export function Headphones(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M9 30v-5a15 15 0 0 1 30 0v5" fill="none" />
      <rect x="6" y="28" width="9" height="13" rx="3" fill="#F8AEDB" />
      <rect x="33" y="28" width="9" height="13" rx="3" fill="#F8AEDB" />
    </svg>
  );
}

export function Play(props: P) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
    </svg>
  );
}

/** Жирный комичный крестик: красная заливка, ink-обводка, чуть кривой — как стикер */
export function Cross(props: P) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <path
        d="M9 5.5 24 18 38.5 6l5 6.5L31 24.5l12.5 11-5.5 6.5L24 30 10.5 42.5 4.5 36 17 24.5 4 13.5Z"
        fill="#C9302C"
        stroke="#111111"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path d="M11 11.5l4 3.5" stroke="#EDE0CF" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Plus(props: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="square"
      {...props}
    >
      <path d="M12 4v16M4 12h16" />
    </svg>
  );
}
