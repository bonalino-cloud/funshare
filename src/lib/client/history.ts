import { useSyncExternalStore } from "react";
import { z } from "zod";
import { GenerationMode, Level, Tier } from "@/contracts";

/**
 * «Мои прожарки» без аккаунта: список генераций этого браузера в localStorage
 * (architecture/create-flow.md §3). Пишется при запуске генерации, читается историей на
 * лендинге и лоудером (картинка выбранной степени). Хранилища может не быть (приватный
 * режим) — тогда история просто пустая.
 */
const KEY = "funshare:history:v1";
const LIMIT = 50;

export const HistoryEntry = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  tier: Tier,
  level: Level,
  mode: GenerationMode,
  createdAt: z.iso.datetime(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

const EMPTY: HistoryEntry[] = [];
let cache: { raw: string | null; list: HistoryEntry[] } = { raw: null, list: EMPTY };
const listeners = new Set<() => void>();

function read(): HistoryEntry[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  // Один и тот же снимок, пока строка не изменилась: useSyncExternalStore сравнивает по ссылке
  if (raw === cache.raw) return cache.list;
  let list = EMPTY;
  try {
    const items: unknown = JSON.parse(raw ?? "[]");
    // По одной: испорченная запись выпадает, остальная история остаётся
    if (Array.isArray(items)) {
      list = items.flatMap((item) => {
        const parsed = HistoryEntry.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
    }
  } catch {
    // битая запись: считаем историю пустой
  }
  cache = { raw, list };
  return list;
}

/** Новая генерация в начало списка; повтор того же id заменяет старую запись. */
export function rememberGeneration(entry: HistoryEntry) {
  const list = [entry, ...read().filter((e) => e.id !== entry.id)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    return;
  }
  listeners.forEach((l) => l());
}

export function recallLevel(id: string): Level | undefined {
  return read().find((e) => e.id === id)?.level;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Прожарка в соседней вкладке тоже попадает в историю
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Список, новые сверху. На сервере пустой. */
export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
