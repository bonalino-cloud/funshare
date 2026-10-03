import Image, { type StaticImageData } from "next/image";
import { cx } from "@/components/cx";

/**
 * Иллюстрация в середине экрана шага: парит без подложки (свечение за маскотом убрали).
 * `scan` — розовая линия сканера на время проверки, `wiggle` — покачивание для ошибки.
 */
export function ArtStage({
  src,
  scan,
  wiggle,
  size = "lg",
  className,
}: {
  src: StaticImageData;
  scan?: boolean;
  wiggle?: boolean;
  size?: "lg" | "md";
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cx("relative flex min-h-[200px] flex-1 items-center justify-center", className)}
    >
      <Image
        src={src}
        alt=""
        priority
        sizes="250px"
        className={cx(
          "relative h-auto",
          size === "lg" ? "w-[250px]" : "w-[200px]",
          wiggle ? "animate-wiggle" : "animate-float",
        )}
      />
      {scan && (
        <span className="absolute inset-x-[12%] h-[3px] animate-scan bg-pink opacity-90 shadow-[0_0_12px_var(--color-pink)]" />
      )}
    </div>
  );
}
