"use client";

import { useState } from "react";
import type { Level } from "@/contracts";
import { Button } from "@/components/ui/Button";
import type { CardTone } from "@/components/ui/Card";
import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/components/cx";
import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import rare from "../assets/level-rare.png";
import medium from "../assets/level-medium.png";
import well from "../assets/level-well.png";
import { LEVEL_NAME } from "../labels";
import { StepTitle } from "../StepTitle";
import { TierCard, TierName } from "../TierCard";
import type { CreateStep } from "../steps";

const LEVEL_UI: Record<Level, { tone: CardTone; image: typeof rare; desc: string }> = {
  rare: {
    tone: "teal",
    image: rare,
    desc: "Мягко. Подколы, которые можно показать маме",
  },
  medium: {
    tone: "orange",
    image: medium,
    desc: "Средне. Без мата, но острые шутки допускаются",
  },
  well_done: {
    tone: "red",
    image: well,
    desc: "Шутки 18+ и мат. Ты сам просил",
  },
};

/**
 * Шаг 4. Три карточки-кнопки без «Дальше». Rare и Medium ведут сразу к итогу,
 * Well done открывает окно: 18+ и мат, красные линии, большой чекбокс, «Согласен».
 */
export function LevelStep({ draft, go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
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
      <StepTitle accent="жарко?">Насколько</StepTitle>
      <div className="flex flex-1 flex-col gap-3">
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
                  <span className="inline-block rounded-sm border-2 border-ink bg-paper px-2 py-1 type-label">
                    18+
                  </span>
                ) : undefined
              }
              title={<TierName>{LEVEL_NAME[level]}</TierName>}
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
            Тут 18+ <span className="tilt text-pink">и мат</span>
          </>
        }
      >
        <p className="text-center type-body text-paper/85">
          Шутки будут жёсткими. Про здоровье, национальность, религию и семью всё равно не шутим.
        </p>
        {draft.mode === "friend" && (
          <p className="text-center type-body font-bold text-paper">
            Получатель прочитает это сам.
          </p>
        )}
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
            Мне есть 18, я понимаю, что будет жёстко
          </span>
        </button>
        <Button
          type="button"
          variant="inverse"
          look="display"
          arrow={false}
          className="h-14 w-full"
          disabled={!agreed}
          onClick={agree}
        >
          Согласен
        </Button>
      </Sheet>
    </>
  );
}
