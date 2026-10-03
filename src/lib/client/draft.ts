import { useSyncExternalStore } from "react";
import { z } from "zod";
import { CheckedProfile, GenerationMode, Level, Tier } from "@/contracts";

/**
 * Черновик флоу создания (шаги 1–5). Живёт в sessionStorage: перезагрузка вкладки его не теряет,
 * закрытие вкладки — теряет. После запуска генерации черновик больше не нужен.
 */
export const CreateDraft = z.object({
  mode: GenerationMode.default("self"),
  instagramUrl: z.string().default(""),
  profileCheckId: z.string().optional(),
  profile: CheckedProfile.optional(),
  extraFacts: z.array(z.string()).default([]),
  tier: Tier.optional(),
  level: Level.optional(),
  ageConfirmed: z.boolean().default(false),
  promoCode: z.string().optional(),
});
export type CreateDraft = z.infer<typeof CreateDraft>;

const KEY = "funshare.create.v2";
export const EMPTY_DRAFT: CreateDraft = CreateDraft.parse({});

let cache: CreateDraft | null = null;
const listeners = new Set<() => void>();

function load(): CreateDraft {
  if (cache) return cache;
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? CreateDraft.safeParse(JSON.parse(raw)) : null;
    cache = parsed?.success ? parsed.data : EMPTY_DRAFT;
  } catch {
    cache = EMPTY_DRAFT;
  }
  return cache;
}

function save(next: CreateDraft) {
  cache = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // приватный режим или переполнение: живём в памяти до перезагрузки
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function patchDraft(patch: Partial<CreateDraft>) {
  save({ ...load(), ...patch });
}

export function resetDraft() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  save(EMPTY_DRAFT);
}

/** На сервере всегда пустой черновик; на клиенте — из sessionStorage после гидрации. */
export function useDraft(): CreateDraft {
  return useSyncExternalStore(subscribe, load, () => EMPTY_DRAFT);
}

/** true после гидрации: пока false, шаг из URL нельзя сверять с черновиком. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
