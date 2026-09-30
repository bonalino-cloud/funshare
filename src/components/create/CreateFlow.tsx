"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { patchDraft, useDraft, useHydrated } from "@/lib/client/draft";
import { CreateShell } from "./CreateShell";
import {
  CREATE_STEPS,
  canOpen,
  isCreateStep,
  maxReachable,
  stepNumber,
  type CreateStep,
} from "./steps";
import { CheckoutStep } from "./steps/CheckoutStep";
import { FactsStep } from "./steps/FactsStep";
import { LevelStep } from "./steps/LevelStep";
import { ProfileStep } from "./steps/ProfileStep";
import { TierStep } from "./steps/TierStep";

const STEP_SCREENS = {
  profile: ProfileStep,
  facts: FactsStep,
  tier: TierStep,
  level: LevelStep,
  checkout: CheckoutStep,
} as const;

/**
 * Шаги 1–5 на одном маршруте /create?step=…: переход — pushState, «назад» браузера ведёт
 * на предыдущий шаг, а не выкидывает из флоу. Шаг из URL сверяется с черновиком:
 * нельзя открыть тариф, пока профиль не проверен.
 */
export function CreateFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const draft = useDraft();
  const hydrated = useHydrated();

  const raw = params.get("step");
  const requested: CreateStep = isCreateStep(raw) ? raw : "profile";
  const step: CreateStep = canOpen(requested, draft) ? requested : maxReachable(draft);

  useEffect(() => {
    if (hydrated && step !== requested) {
      window.history.replaceState(null, "", `?step=${step}`);
    }
  }, [hydrated, step, requested]);

  const go = (next: CreateStep) => {
    window.history.pushState(null, "", `?step=${next}`);
    window.scrollTo(0, 0);
  };
  const back = () => {
    const i = CREATE_STEPS.indexOf(step);
    if (i > 0) return go(CREATE_STEPS[i - 1] ?? "profile");
    // На шаге 1 «назад» с экрана «Нашли!» возвращает к полю, а с поля — на лендинг
    if (draft.profile) patchDraft({ profileCheckId: undefined, profile: undefined });
    else router.push("/roast");
  };

  const Screen = STEP_SCREENS[step];

  return (
    <CreateShell step={stepNumber(step)} onBack={back}>
      {hydrated && <Screen draft={draft} go={go} />}
    </CreateShell>
  );
}
