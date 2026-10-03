import type { CreateDraft } from "@/lib/client/draft";

/** Шаги 1–5 живут на /create?step=…; шаги 6 (шутки) и 7 (готово) — на /g/[id]. */
export const CREATE_STEPS = ["profile", "facts", "tier", "level", "checkout"] as const;
export type CreateStep = (typeof CREATE_STEPS)[number];

export const TOTAL_STEPS = 7;

export function stepNumber(step: CreateStep): number {
  return CREATE_STEPS.indexOf(step) + 1;
}

export function isCreateStep(value: string | null): value is CreateStep {
  return (CREATE_STEPS as readonly string[]).includes(value ?? "");
}

/** Самый дальний шаг, который можно открыть по текущему черновику (ссылкой или кнопкой «назад» в браузере). */
export function maxReachable(d: CreateDraft): CreateStep {
  if (!d.profileCheckId || !d.profile) return "profile";
  if (d.tier === undefined) return "tier";
  if (d.level === undefined || (d.level === "well_done" && !d.ageConfirmed)) return "level";
  return "checkout";
}

export function canOpen(step: CreateStep, d: CreateDraft): boolean {
  return CREATE_STEPS.indexOf(step) <= CREATE_STEPS.indexOf(maxReachable(d));
}
