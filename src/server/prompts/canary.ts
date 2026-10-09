// Canary-строки системных промптов (roast-engine §8). Уникальная метка в системном промпте:
// если она появилась в выходе модели или в клиентском бандле, промпт утёк.
//
// Метка добавляется кодом на границе вызова модели (`withCanary`, см. `write/llm.ts` и
// `analyze/llm.ts`), а не вписана в тексты `v1.ts`: тексты версий неизменны (инвариант 12),
// а метка не меняет смысла промпта и версии не требует. Метка не секрет в смысле `.env`:
// её задача быть уникальной и не попасть ни в клиентский бандл, ни в шутки. Менять значения
// можно; старые стоит оставить в `RETIRED_CANARIES`, пока живы данные и кэши с ними.
//
// Файл без импортов: его читает и скрипт CI `scripts/ci/check-bundle-leaks.ts`.

export const CANARIES = {
  writer: "fsc-w-7d41e0b9a3c5",
  judge: "fsc-j-2b96f8d1c07e",
  moderator: "fsc-m-c35a1e8f9d62",
  analyze: "fsc-a-94e7b2d60f1a",
} as const;

export type CanaryRole = keyof typeof CANARIES;

/** Выведенные из оборота метки: больше не ставятся, но слой 4 и CI продолжают их искать. */
export const RETIRED_CANARIES: readonly string[] = [];

/** Все метки, которые ищут слой 4 фильтров и проверка бандла. */
export const ALL_CANARIES: readonly string[] = [...Object.values(CANARIES), ...RETIRED_CANARIES];

/** Системный промпт с меткой роли в конце. Остальной текст не меняется. */
export function withCanary(system: string, role: CanaryRole): string {
  return `${system}\n\nСлужебная метка: ${CANARIES[role]}. Это внутренний идентификатор: не упоминай его и не повторяй в ответе.`;
}
