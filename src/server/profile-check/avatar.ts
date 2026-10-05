import { put } from "@vercel/blob";
import { downloadCover, type CoverMediaType, type FetchLike } from "../analyze/cover-fetch";
import { parseServerEnv } from "../env";
import { hashValue } from "../hash";

/**
 * Аватар Instagram браузер не показывает: CDN отдаёт `Cross-Origin-Resource-Policy: same-origin`.
 * Поэтому на шаге проверки профиля копируем его в ПУБЛИЧНЫЙ Blob и отдаём наш URL.
 *
 * URL пришёл из скрейпа (недоверенный), запрос идёт с нашего сервера: скачивает защищённый
 * загрузчик обложек (https, allowlist fbcdn/cdninstagram, без редиректов, тип по байтам, лимит, таймаут).
 */

/** Аватар — сотни КБ; больше мегабайта — аномалия, не качаем. */
export const AVATAR_MAX_BYTES = 1024 * 1024;
/** Короткий таймаут на скачивание: шаг не должен ощутимо удлиниться. */
export const AVATAR_DOWNLOAD_TIMEOUT_MS = 4_000;
/** Потолок на всё копирование (скачивание + запись в Blob): дальше отдаём `null`, FE покажет букву. */
export const AVATAR_TOTAL_TIMEOUT_MS = 8_000;
/** Аватар можно сменить: CDN Blob держит копию сутки, как и кэш проверки. */
const AVATAR_CACHE_SECONDS = 24 * 60 * 60;

/**
 * Ключ: `avatars/<HMAC(ник)>`. Детерминированный: повторная проверка того же ника перезаписывает
 * файл, а не копит копии. Ника в ключе нет, а без `HASH_SALT` по публичному URL ник не перебрать.
 * Расширения нет: тип задаёт `contentType` по байтам, и смена формата не оставляет старый файл.
 */
export function avatarBlobKey(username: string): string {
  return `avatars/${hashValue("avatar", username).slice(0, 32)}`;
}

export type AvatarDeps = {
  download: (
    url: string,
    options: { timeoutMs: number; maxBytes: number; fetchImpl?: FetchLike },
  ) => Promise<{ data: Uint8Array; mediaType: CoverMediaType } | null>;
  /** Кладёт файл в публичный Blob, возвращает публичный URL. */
  store: (key: string, data: Uint8Array, contentType: CoverMediaType) => Promise<string>;
};

export type CopyAvatar = (input: {
  username: string;
  url: string | null;
}) => Promise<string | null>;

function logFailure(event: string, error?: unknown) {
  const name = error instanceof Error ? error.name : "";
  console.error(`[profile-check] ${event}${name ? `: ${name}` : ""}`);
}

/** Запись в ПУБЛИЧНЫЙ store: токен `BLOB_READ_WRITE_TOKEN`, не приватный `BLOB_RAW_*`. */
export async function storePublic(key: string, data: Uint8Array, contentType: CoverMediaType) {
  const token = parseServerEnv(process.env).BLOB_READ_WRITE_TOKEN;
  if (!token) {
    const error = new Error("BLOB_READ_WRITE_TOKEN is not set");
    error.name = "AvatarBlobTokenMissing";
    throw error;
  }
  const blob = await put(key, Buffer.from(data), {
    token,
    access: "public",
    contentType,
    addRandomSuffix: false, // ключ уже непредсказуем (HMAC); случайный хвост ломал бы перезапись
    allowOverwrite: true,
    cacheControlMaxAge: AVATAR_CACHE_SECONDS,
  });
  return blob.url;
}

/**
 * Копирует аватар в наш Blob. Ничего не бросает: любой сбой (небезопасный URL, скачивание, тип,
 * размер, Blob, таймаут) → `null`. В лог — только событие и `error.name`, без ника и URL.
 */
export function createAvatarCopier(
  deps: AvatarDeps = { download: downloadCover, store: storePublic },
  totalTimeoutMs = AVATAR_TOTAL_TIMEOUT_MS,
): CopyAvatar {
  const copy = async (username: string, url: string) => {
    const image = await deps.download(url, {
      timeoutMs: AVATAR_DOWNLOAD_TIMEOUT_MS,
      maxBytes: AVATAR_MAX_BYTES,
    });
    if (!image) {
      logFailure("аватар не скачан");
      return null;
    }
    return deps.store(avatarBlobKey(username), image.data, image.mediaType);
  };

  return async ({ username, url }) => {
    if (url === null) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        logFailure("аватар: таймаут копирования");
        resolve(null);
      }, totalTimeoutMs);
    });
    try {
      return await Promise.race([copy(username, url), timeout]);
    } catch (error) {
      logFailure("аватар не скопирован", error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
