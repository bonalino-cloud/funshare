"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { initMetrika, trackPage } from "@/lib/client/analytics";

/**
 * Счётчик Яндекс Метрики: ставится после гидрации, чтобы не тормозить первый экран. Переходы
 * между страницами без перезагрузки шлём сами. Шаги внутри /create — это цели `step_view`,
 * а не просмотры, поэтому следим только за путём.
 */
export function Metrika() {
  const pathname = usePathname();
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    const url = window.location.href;
    if (lastUrl.current === null) {
      initMetrika();
    } else if (lastUrl.current !== url) {
      trackPage(url, lastUrl.current);
    }
    lastUrl.current = url;
  }, [pathname]);

  return null;
}
