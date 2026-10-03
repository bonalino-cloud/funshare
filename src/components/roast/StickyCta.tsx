"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/cx";
import { FireButton } from "./FireButton";

/**
 * Липкая «Прожарить»: появляется, когда hero ушёл с экрана, и прячется на финальном CTA,
 * чтобы не было двух одинаковых кнопок рядом. На мобиле — по центру снизу, на десктопе — справа.
 */
export function StickyCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const hero = document.querySelector("[data-hero]");
    const end = document.getElementById("start");
    let heroGone = false;
    let atEnd = false;
    const sync = () => setShow(heroGone && !atEnd);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === hero) heroGone = !e.isIntersecting;
        if (e.target === end) atEnd = e.isIntersecting;
      }
      sync();
    });
    if (hero) io.observe(hero);
    if (end) io.observe(end);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className={cx(
        "fixed bottom-4 left-1/2 z-40 -translate-x-1/2 transition-[translate,opacity] duration-300 ease-[var(--ease-poster)] md:right-6 md:bottom-6 md:left-auto md:translate-x-0",
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-24 opacity-0",
      )}
    >
      <FireButton size="sm" cut={null} href="/create">
        Прожарить
      </FireButton>
    </div>
  );
}
