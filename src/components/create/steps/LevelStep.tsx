"use client";

import { useState } from "react";
import type { Level } from "@/contracts";
import { Button } from "@/components/ui/Button";
import type { CardTone } from "@/components/ui/Card";
import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/components/cx";
import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import { HotIcon } from "../icons";
import { LEVEL_NAME } from "../labels";
import { LEVEL_ART } from "../levelArt";
import { StepTitle } from "../StepTitle";
import { TierCard, TierName } from "../TierCard";
import type { CreateStep } from "../steps";

/** Огоньки над названием: один, два, три — как перчики у тарифов */
const FLAMES: Record<Level, number> = { rare: 1, medium: 2, well_done: 3 };

const LEVEL_UI: Record<Level, { tone: CardTone; image: (typeof LEVEL_ART)[Level]; desc: string }> =
  {
    rare: {
      tone: "yellow",
      image: LEVEL_ART.rare,
      desc: "Мягко. Подколы, которые можно показать маме",
    },
    medium: {
      tone: "orange",
      image: LEVEL_ART.medium,
      desc: "Средне. Без мата, но острые шутки допускаются",
    },
    well_done: {
      tone: "red",
      image: LEVEL_ART.well_done,
      desc: "Шутки 18+ и мат. Ты сам просил",
    },
  };

/**
 * Шаг 4. Три карточки-кнопки без «Дальше». Rare и Medium ведут сразу к итогу,
 * Well done открывает окно «Будет жёстко»: 18+, мат, внешность можно, запретные темы нет, большой чекбокс, «Согласен».
 */
export function LevelStep({ go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  const [warn, setWarn] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const pick = (level: Level) => {
    if (level === "well_done") {
      setAgreed(false);
      setWarn(true);
      return;
    }
    patchDraft({ level, ageConfirmed: false });
    go("checkout");
  };

  const agree = () => {
    patchDraft({ level: "well_done", ageConfirmed: true });
    setWarn(false);
    go("checkout");
  };

  return (
    <>
      <StepTitle accent="прожарки" split>
        Степень
      </StepTitle>
      <div className="grid flex-1 auto-rows-fr gap-3 pt-6 pb-6">
        {(["rare", "medium", "well_done"] as const).map((level) => {
          const ui = LEVEL_UI[level];
          return (
            <TierCard
              key={level}
              tone={ui.tone}
              image={ui.image}
              onClick={() => pick(level)}
              corner={
                level === "well_done" ? (
                  <span className="inline-block origin-top-right rounded-sm border-2 border-ink bg-paper px-2 py-1 type-label transition-transform duration-200 ease-[var(--ease-poster)] group-hover:scale-[1.2]">
                    18+
                  </span>
                ) : undefined
              }
              title={
                <>
                  <span aria-hidden="true" className="relative z-10 mb-1.5 flex h-5 gap-0.5">
                    {Array.from({ length: FLAMES[level] }, (_, i) => (
                      <HotIcon key={i} className="size-5" />
                    ))}
                  </span>
                  <TierName>{LEVEL_NAME[level]}</TierName>
                </>
              }
            >
              <p className="relative z-10 mt-1.5 type-body font-semibold">{ui.desc}</p>
            </TierCard>
          );
        })}
      </div>

      <Sheet
        open={warn}
        onClose={() => setWarn(false)}
        title={
          <>
            Будет <span className="tilt text-pink">жёстко</span>
          </>
        }
      >
        <p className="text-center type-body text-paper/85">
          Тут 18+ шутки и мат, можно шутить про внешность лица и сексуальность. Но болезни,
          тяжёлые события, детей, национальность, религию, политику и ориентацию мы не трогаем
          и тут.
        </p>
        <button
          type="button"
          role="checkbox"
          aria-checked={agreed}
          onClick={() => setAgreed((v) => !v)}
          className="flex items-center gap-3 py-1.5 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink"
        >
          <span
            aria-hidden="true"
            className={cx(
              "flex size-9 shrink-0 items-center justify-center rounded-sm border-2 text-xl font-extrabold text-ink",
              agreed ? "border-ink bg-pink" : "border-white bg-transparent",
            )}
          >
            {agreed && "✓"}
          </span>
          <span className="type-body font-bold text-paper">
            Мне есть 18 и я беру всю ответственность на себя
          </span>
        </button>
        <Button
          type="button"
          variant="inverse"
          look="display"
          arrow={false}
          className="h-16 w-full"
          disabled={!agreed}
          onClick={agree}
        >
          Согласен
        </Button>
      </Sheet>
    </>
  );
}
