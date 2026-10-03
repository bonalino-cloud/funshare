import { put } from "@vercel/blob";

/**
 * Ключ сырого ответа: `raw/<igUsername>/<fetchedAt>.json`. ISO-время без `:` и `.`,
 * чтобы ключ был безопасным; по префиксу `raw/` и времени Cron удаляет сырьё старше 30 дней.
 */
export function rawBlobKey(igUsername: string, fetchedAt: Date): string {
  return `raw/${igUsername}/${fetchedAt.toISOString().replace(/[:.]/g, "-")}.json`;
}

/** Запись сырого ответа в PRIVATE Blob (читать можно только с токеном). Токен берёт SDK из env. */
export async function putRawBlob(key: string, json: string): Promise<void> {
  await put(key, json, {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    // Повтор того же шага с тем же временем безопасен (идемпотентность).
    allowOverwrite: true,
  });
}
