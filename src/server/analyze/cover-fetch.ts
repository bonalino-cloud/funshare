import sharp from "sharp";
import type { Cover } from "./covers";

/**
 * Скачивание обложек на нашей стороне. Anthropic не может скачать их сам: robots.txt CDN
 * Instagram запрещает (400 invalid_request_error), поэтому модели уходят байты.
 *
 * URL пришёл из скрейпа: это недоверенный внешний контент, а запрос идёт с нашего сервера.
 * Защита от SSRF: только https, хост из allowlist (точное совпадение по суффиксу с точкой),
 * без логина/пароля и нестандартного порта, редиректы не следуем, куки и наши заголовки не шлём.
 */

export const COVER_ALLOWED_HOST_SUFFIXES = ["fbcdn.net", "cdninstagram.com"] as const;
/**
 * Потолок на одну обложку (сырые байты). Anthropic меряет 5 МБ по base64 (+33 %), а весь запрос
 * ограничен 32 МБ: 6 × 3 МБ → ~24 МБ base64 с запасом под текст. Обложки Instagram 1080 px
 * весят сотни КБ, так что потолок срабатывает только на аномалиях.
 */
export const COVER_MAX_BYTES = 3 * 1024 * 1024;
/** Таймаут на одну обложку целиком (заголовки + тело). Качаем параллельно: общий бюджет тот же. */
export const COVER_TIMEOUT_MS = 5_000;

/**
 * Обложки уходят модели в уменьшенном виде: длинная сторона не больше 512 px, JPEG. Детали для
 * досье (одежда, обстановка, лицо крупным планом) на 512 px читаются, а токены на картинки падают
 * в разы против 1080 px. Кадр не увеличиваем.
 */
export const COVER_MAX_SIDE_PX = 512;
const COVER_JPEG_QUALITY = 80;
/** Потолок пикселей на входе: защита от «бомб» (маленький файл, огромная картинка). */
const COVER_MAX_INPUT_PIXELS = 50_000_000;

export type ResizeCoverFn = (
  data: Uint8Array,
) => Promise<{ data: Uint8Array; mediaType: "image/jpeg" }>;

/** Уменьшает до `COVER_MAX_SIDE_PX` по длинной стороне, поворот по EXIF, прозрачность на белый. */
export const resizeCover: ResizeCoverFn = async (data) => {
  const out = await sharp(data, { limitInputPixels: COVER_MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: COVER_MAX_SIDE_PX,
      height: COVER_MAX_SIDE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: COVER_JPEG_QUALITY })
    .toBuffer();
  return { data: new Uint8Array(out), mediaType: "image/jpeg" };
};

export type CoverMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const MEDIA_TYPES: ReadonlySet<string> = new Set<CoverMediaType>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Обложка, уже скачанная: `index` = индекс поста, `url` нужен только постобработке. */
export type DownloadedCover = Cover & { data: Uint8Array; mediaType: CoverMediaType };

/** Реализация подменяется в тестах: сеть недоступна. Не бросает: недоступные обложки пропускает. */
export type FetchCoversFn = (covers: readonly Cover[]) => Promise<DownloadedCover[]>;

export function isAllowedCoverUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "" || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  return COVER_ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`));
}

/** Тип по сигнатуре файла: заголовку `content-type` одному не верим. */
export function sniffImageType(bytes: Uint8Array): CoverMediaType | null {
  const startsWith = (offset: number, signature: readonly number[]) =>
    bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
  const text = (value: string) => [...value].map((c) => c.charCodeAt(0));

  if (startsWith(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(0, text("GIF87a")) || startsWith(0, text("GIF89a"))) return "image/gif";
  if (startsWith(0, text("RIFF")) && startsWith(8, text("WEBP"))) return "image/webp";
  return null;
}

/** Читает тело с жёстким потолком: на превышении обрывает поток, не копит память. */
async function readLimited(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array | "too_large" | null> {
  const reader = body.getReader();
  // Зависшее тело не должно держать шаг: по таймауту обрываем чтение сами, не полагаясь на fetch.
  const aborted = new Promise<never>((_resolve, reject) => {
    // Таймаут мог сработать ещё до чтения: событие "abort" повторно не придёт.
    if (signal.aborted) reject(new Error("timeout"));
    else signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  });
  aborted.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "too_large";
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
type CoverFetchOptions = { fetchImpl?: FetchLike; timeoutMs?: number; maxBytes?: number };

/** Почему обложка не скачалась. Только коды: в лог идут счётчики, без URL. */
export type CoverFailure = "host" | "status" | "type" | "size" | "read" | "network";
type CoverOutcome = { data: Uint8Array; mediaType: CoverMediaType } | { failure: CoverFailure };

async function tryDownloadCover(url: string, options: CoverFetchOptions): Promise<CoverOutcome> {
  const { fetchImpl = fetch, timeoutMs = COVER_TIMEOUT_MS, maxBytes = COVER_MAX_BYTES } = options;
  if (!isAllowedCoverUrl(url)) return { failure: "host" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual", // 3xx не следуем: Location мог бы увести на внутренний адрес
      credentials: "omit",
      cache: "no-store", // фото человека не кладём в Data Cache Next (сырьё живёт ≤ 30 дней)
      headers: { accept: "image/jpeg,image/png,image/webp,image/gif" },
      signal: controller.signal,
    });
    // Ранний выход — тело отменяем: иначе undici держит соединение до сборки мусора.
    const reject = async (failure: CoverFailure): Promise<CoverOutcome> => {
      await response.body?.cancel().catch(() => undefined);
      return { failure };
    };
    if (response.status !== 200 || !response.body) return reject("status");

    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!MEDIA_TYPES.has(type)) return reject("type");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return reject("size");

    const data = await readLimited(response.body, maxBytes, controller.signal);
    if (data === "too_large") return { failure: "size" };
    if (!data || data.byteLength === 0) return { failure: "read" };
    const mediaType = sniffImageType(data);
    return mediaType ? { data, mediaType } : { failure: "type" };
  } catch {
    return { failure: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** Одна обложка → байты или null (любая причина: allowlist, статус, тип, размер, таймаут, сеть). */
export async function downloadCover(
  url: string,
  options: CoverFetchOptions = {},
): Promise<{ data: Uint8Array; mediaType: CoverMediaType } | null> {
  const outcome = await tryDownloadCover(url, options);
  return "failure" in outcome ? null : outcome;
}

/**
 * Все обложки параллельно; не скачавшиеся пропускаются, `index` остальных не меняется.
 * Причины отказов — в лог счётчиками (`status=2 host=1`): так видно смену CDN или протухшие ссылки.
 */
export function createCoverFetcher(
  options: { fetchImpl?: FetchLike; timeoutMs?: number; resize?: ResizeCoverFn } = {},
): FetchCoversFn {
  const resize = options.resize ?? resizeCover;
  return async (covers) => {
    const failures = new Map<CoverFailure, number>();
    let notResized = 0;
    const results = await Promise.all(
      covers.map(async (cover) => {
        const outcome = await tryDownloadCover(cover.url, options);
        if (!("failure" in outcome)) {
          // Не уменьшилось (битый файл, нет нативного модуля) — отдаём оригинал: он уже прошёл
          // потолок размера и тип по байтам, а анализ не должен терять картинки из-за ресайза.
          try {
            return { ...cover, ...(await resize(outcome.data)) };
          } catch {
            notResized++;
            return { ...cover, ...outcome };
          }
        }
        failures.set(outcome.failure, (failures.get(outcome.failure) ?? 0) + 1);
        return null;
      }),
    );
    if (notResized > 0)
      console.error(`[analyze] обложки не уменьшены, ушли оригиналом: ${notResized}`);
    if (failures.size > 0) {
      const summary = [...failures].map(([reason, n]) => `${reason}=${n}`).join(" ");
      console.error(`[analyze] обложки не скачаны: ${summary}`);
    }
    return results.filter((r): r is DownloadedCover => r !== null);
  };
}
