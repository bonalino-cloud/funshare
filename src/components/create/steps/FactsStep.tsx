"use client";

import { useState } from "react";
import type { GenerationMode } from "@/contracts";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import { StepLead, StepTitle } from "../StepTitle";
import type { CreateStep } from "../steps";

const MAX_FACTS = 5;
const MAX_LEN = 140;
const MIN_FIELDS = 2;

/** Плейсхолдеры — сразу примеры, склоняются по режиму «Себя / Друга» */
const EXAMPLES: Record<GenerationMode, readonly string[]> = {
  self: [
    "Опаздываю на всё, кроме рейсов",
    "Называю кофе бензином",
    "Обещаю «летом бросить соцсети» третий год",
    "Ем суши вилкой",
    "Ставлю будильник на 5:00 и встаю в 9",
  ],
  friend: [
    "Опаздывает на всё, кроме рейсов",
    "Называет кофе бензином",
    "Обещает «летом бросить соцсети» третий год",
    "Ест суши вилкой",
    "Ставит будильник на 5:00 и встаёт в 9",
  ],
};

function initialFields(saved: string[]): string[] {
  const fields = [...saved];
  while (fields.length < MIN_FIELDS) fields.push("");
  return fields.slice(0, MAX_FACTS);
}

/**
 * Шаг 2. Необязательный: до 5 фактов по 140 знаков. Никаких подсказок про лимиты и темы,
 * единственное сообщение — при превышении длины. Пустые поля просто не отправляются.
 */
export function FactsStep({ draft, go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  const [fields, setFields] = useState(() => initialFields(draft.extraFacts));
  const examples = EXAMPLES[draft.mode];
  const tooLong = fields.some((f) => f.trim().length > MAX_LEN);
  const hasFacts = fields.some((f) => f.trim().length > 0);

  const update = (i: number, value: string) =>
    setFields((prev) => prev.map((f, j) => (j === i ? value : f)));

  const next = () => {
    patchDraft({ extraFacts: fields.map((f) => f.trim()).filter(Boolean) });
    go("tier");
  };

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tooLong) next();
      }}
    >
      <StepTitle accent="факты">Добавь</StepTitle>
      <StepLead>Чем больше пикантных фактов, тем точнее и смешнее получится прожарка</StepLead>

      <div className="flex flex-col gap-4">
        {fields.map((value, i) => {
          const len = value.trim().length;
          return (
            <TextArea
              key={i}
              name={`fact-${i + 1}`}
              aria-label={`Факт ${i + 1}`}
              placeholder={examples[i]}
              size="lg"
              value={value}
              onChange={(e) => update(i, e.target.value)}
              error={
                len > MAX_LEN
                  ? `Слишком длинно, сократи до ${MAX_LEN} знаков. Сейчас ${len}`
                  : undefined
              }
            />
          );
        })}
        {fields.length < MAX_FACTS && (
          <button
            type="button"
            aria-label="Ещё факт"
            onClick={() => setFields((prev) => [...prev, ""])}
            className="mx-auto mt-6 flex size-14 items-center justify-center rounded-full border-2 border-white text-paper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pink"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-4">
        {/* Одна кнопка: без фактов — «Продолжить без фактов», с фактами — «Дальше» */}
        <Button
          type="submit"
          variant="ghost"
          look="display"
          arrow={false}
          className="h-16 w-full"
          disabled={tooLong}
        >
          {hasFacts ? "Дальше" : "Продолжить без фактов"}
        </Button>
      </div>
    </form>
  );
}
