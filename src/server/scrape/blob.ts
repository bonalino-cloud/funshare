import { put } from "@vercel/blob";
import { parseServerEnv } from "../env";

/**
 * Ключ сырого ответа: `raw/<igUsername>/<fetchedAt>.json`. ISO-время без `:` и `.`,
 * чтобы ключ был безопасным; по префиксу `raw/` и времени Cron удаляет сырьё старше 30 дней.
 */
export function rawBlobKey(igUsername: string, fetchedAt: Date): string {
  return `raw/${igUsername}/${fetchedAt.toISOString().replace(/[:.]/g, "-")}.json`;
}

/**
 * Токен private store для сырья — только BLOB_RAW_READ_WRITE_TOKEN. Публичный BLOB_READ_WRITE_TOKEN
 * не подходит (private-запись в публичный store падает) и не должен быть запасным вариантом.
 * Любой вызов SDK по `raw/` (put, list, del в Cron очистки) передаёт этот токен явно: без `token`
 * SDK берёт BLOB_READ_WRITE_TOKEN и смотрит в public store.
 */
export function rawBlobToken(source: Record<string, string | undefined> = process.env): string {
  const token = parseServerEnv(source).BLOB_RAW_READ_WRITE_TOKEN;
  if (!token) {
    const error = new Error(
      "BLOB_RAW_READ_WRITE_TOKEN is not set: raw scrape needs the private Blob store",
    );
    // Лог скрейпа пишет только name ошибки: по нему видно причину, а не просто «Error».
    error.name = "RawBlobTokenMissing";
    throw error;
  }
  return token;
}

/** Запись сырого ответа в PRIVATE Blob (читать можно только с токеном). */
export async function putRawBlob(
  key: string,
  json: string,
  source: Record<string, string | undefined> = process.env,
): Promise<void> {
  const token = rawBlobToken(source);
  await put(key, json, {
    token,
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    // Повтор того же шага с тем же временем безопасен (идемпотентность).
    allowOverwrite: true,
  });
}
