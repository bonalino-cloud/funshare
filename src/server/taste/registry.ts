import { TASTE_V1 } from "./packs/v1";
import type { TastePack } from "./types";

// Реестр пакетов вкуса. Новый пакет: файл `packs/v<N>.ts` с `TastePack`, строка в `BUILT_IN`,
// имя в `CURRENT_TASTE_PACK`, если он должен стать текущим. Код шага `write` не меняется.

/** ЕДИНСТВЕННОЕ место, где задан текущий пакет. Выкатка долей и выбор из БД это H6. */
export const CURRENT_TASTE_PACK = "taste/v1";

/** Имя без пакета: ошибка конфигурации, а не данных. Бросается до первого вызова LLM. */
export class UnknownTastePackError extends Error {
  constructor(readonly packName: string) {
    super(`unknown taste pack: ${packName}`);
    this.name = "UnknownTastePackError";
  }
}

const BUILT_IN: readonly TastePack[] = [TASTE_V1];
const packs = new Map<string, TastePack>(BUILT_IN.map((p) => [p.name, p]));

/** Пакет по имени (по умолчанию текущий). Неизвестное имя: `UnknownTastePackError`. */
export function getTastePack(name: string = CURRENT_TASTE_PACK): TastePack {
  const pack = packs.get(name);
  if (!pack) throw new UnknownTastePackError(name);
  return pack;
}

export function listTastePacks(): string[] {
  return [...packs.keys()];
}

/** Для тестов и eval (H3): добавить пакет на время процесса. Имя занято: ошибка. */
export function registerTastePack(pack: TastePack): void {
  if (packs.has(pack.name)) throw new Error(`taste pack already registered: ${pack.name}`);
  packs.set(pack.name, pack);
}

/** Для тестов: убрать пакет, добавленный `registerTastePack`. Встроенные не удаляются. */
export function unregisterTastePack(name: string): void {
  if (BUILT_IN.some((p) => p.name === name)) throw new Error(`built-in pack: ${name}`);
  packs.delete(name);
}
