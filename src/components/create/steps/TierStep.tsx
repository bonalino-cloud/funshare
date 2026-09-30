"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { Pricing, Tier, TierInfo } from "@/contracts";
import type { CardTone } from "@/components/ui/Card";
import chili from "../assets/sticker-chili-plain.png";
import ogon from "@/components/roast/assets/level-ogon.png";
import koster from "@/components/roast/assets/level-koster.png";
import peklo from "@/components/roast/assets/level-peklo.png";
import { api, toErrorCode } from "@/lib/client/api";
import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import { formatRub } from "@/lib/client/money";
import { errorLine } from "../errors";
import { TIER_NAME } from "../labels";
import { StepTitle } from "../StepTitle";
import { TierCard, TierList, TierName } from "../TierCard";
import type { CreateStep } from "../steps";

/** Названия, цвета и маскоты живут у FE; цены и состав приходят из /api/pricing */
const TIER_UI: Record<Tier, { tone: CardTone; image: typeof ogon; chilis: number }> = {
  1: { tone: "yellow", image: ogon, chilis: 1 },
  2: { tone: "orange", image: koster, chilis: 2 },
  3: { tone: "red", image: peklo, chilis: 3 },
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
};

function items(t: TierInfo, base: TierInfo | undefined): string[] {
  const out: string[] = [];
  if (t.imageCount === 0) out.push("Шутки, только текст");
  else if (base && t.candidateCount > base.candidateCount) out.push("Ещё больше шуток");
  if (t.imageCount > 0) out.push(plural(t.imageCount, "картинка", "картинки", "картинок"));
  if (t.tier === 3) out.push("Видео для сторис");
  return out;
}

/**
 * Шаг 3. Три карточки-кнопки на весь экран, без «Дальше»: нажатие ведёт к степени прожарки,
 * вернуться можно стрелкой. Цены в копейках приходят с сервера, клиент только показывает.
 */
export function TierStep({ go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .getPricing()
      .then((p) => alive && setPricing(p))
      .catch((e: unknown) => alive && setError(errorLine(toErrorCode(e))));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const pick = (tier: Tier) => {
    patchDraft({ tier });
    go("level");
  };

  const base = pricing?.tiers.find((t) => t.tier === 1);

  return (
    <>
      <StepTitle accent="получишь?">Что</StepTitle>
      {error ? (
        <div className="flex flex-1 flex-col items-start gap-3">
          <p className="border-l-2 border-red pl-3 type-body text-paper">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
            className="type-label text-pink underline underline-offset-4"
          >
            Ещё раз
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {([1, 2, 3] as const).map((tier) => {
            const ui = TIER_UI[tier];
            const info = pricing?.tiers.find((t) => t.tier === tier);
            const free = tier === 1 && pricing?.freeTrialAvailable;
            return (
              <TierCard
                key={tier}
                tone={ui.tone}
                image={ui.image}
                onClick={() => pick(tier)}
                corner={
                  info && tier === 3 && !info.video ? (
                    <span className="inline-block rounded-sm border-2 border-dashed border-ink px-2 py-1 type-label">
                      Видео скоро
                    </span>
                  ) : undefined
                }
                title={
                  <>
                    <span aria-hidden="true" className="relative z-10 mb-1.5 flex h-8 -space-x-1.5">
                      {Array.from({ length: ui.chilis }, (_, i) => (
                        <Image key={i} src={chili} alt="" className="h-8 w-auto" sizes="32px" />
                      ))}
                    </span>
                    <TierName>{TIER_NAME[tier]}</TierName>
                  </>
                }
                footer={
                  info ? (
                    <span className="relative z-10 flex flex-wrap items-center gap-2 font-wide text-lg leading-none font-extrabold">
                      {free ? (
                        <>
                          <s className="font-bold opacity-55">{formatRub(info.listAmount)}</s>
                          Бесплатно
                        </>
                      ) : (
                        formatRub(info.listAmount)
                      )}
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="block h-5 w-16 animate-pulse rounded-sm bg-ink/15"
                    />
                  )
                }
              >
                {info && <TierList items={items(info, base)} />}
              </TierCard>
            );
          })}
        </div>
      )}
    </>
  );
}
