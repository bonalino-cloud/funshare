import { cx } from "@/components/cx";
import { Flower } from "./Flower";

type Tone = "violet" | "paper" | "sun" | "tomato" | "lime";

const tones: Record<Tone, string> = {
  violet: "bg-violet text-paper",
  paper: "bg-paper text-ink",
  sun: "bg-sun text-ink",
  tomato: "bg-tomato text-ink",
  lime: "bg-lime text-ink",
};

/**
 * Круглый стикер с цветком и кремовым кольцом. Лежит на углу блока,
 * наполовину выходя за край (реф: фиолетовый бейдж у TANOSHII PARK).
 */
export function Sticker({
  tone = "violet",
  spin = true,
  className,
}: {
  tone?: Tone;
  spin?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid size-24 place-items-center rounded-full border-[6px] border-paper shadow-sticker md:size-32",
        tones[tone],
        className,
      )}
    >
      <Flower className={cx("size-3/5", spin && "animate-spin-slow")} />
    </span>
  );
}
