import type { ReactNode } from "react";
import { cx } from "@/components/cx";

/** Заголовок шага: Unbounded, часть слова наклонена и розовая (DESIGN.md §3.3). */
export function StepTitle({
  children,
  accent,
  size = "l",
  className,
}: {
  children: ReactNode;
  /** Наклонная розовая часть, ставится после основного текста */
  accent?: ReactNode;
  size?: "l" | "m";
  className?: string;
}) {
  return (
    <h1
      className={cx(
        size === "l" ? "type-display-l" : "type-display-m",
        "mb-2.5 text-center text-paper",
        className,
      )}
    >
      {children}
      {accent && (
        <>
          {" "}
          <span className="tilt text-pink">{accent}</span>
        </>
      )}
    </h1>
  );
}

/** Подзаголовок шага */
export function StepLead({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-center type-lead text-paper/70">{children}</p>;
}
