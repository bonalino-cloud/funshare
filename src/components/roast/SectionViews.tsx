"use client";

import { useEffect } from "react";
import { LANDING_SECTIONS, track, type LandingSection } from "@/lib/client/analytics";

/**
 * «Доскроллил до раздела»: по одному событию на раздел за заход. Верх области наблюдения поднят
 * далеко над экраном: раздел, который пролетели быстрым скроллом, тоже считается увиденным.
 */
const PASSED_ABOVE = "100000px 0px 0px 0px";

function isLandingSection(id: string): id is LandingSection {
  return (LANDING_SECTIONS as readonly string[]).includes(id);
}

export function SectionViews() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || !isLandingSection(e.target.id)) continue;
          io.unobserve(e.target);
          track("section_view", { section: e.target.id });
        }
      },
      { rootMargin: PASSED_ABOVE },
    );
    for (const id of LANDING_SECTIONS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return null;
}
