import { parseServerEnv } from "../env";

/** Ошибка получения ответа от Apify. `retryable` — стоит ли повторить запрос один раз. */
export class ScrapeTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ScrapeTransportError";
  }
}

export const APIFY_ACTOR = "apify~instagram-profile-scraper";
/** Таймаут актора, секунды (параметр `timeout`). */
export const ACTOR_TIMEOUT_SECONDS = 40;
/** Жёсткий обрыв запроса у нас: актору 40 с и небольшой запас на сеть. */
const ABORT_AFTER_MS = (ACTOR_TIMEOUT_SECONDS + 3) * 1000;

export type ApifyFetcherOptions = {
  /** По умолчанию `APIFY_TOKEN` из окружения (читается при вызове). */
  token?: string;
  fetchImpl?: typeof fetch;
  abortAfterMs?: number;
};

function readToken(): string {
  const token = parseServerEnv(process.env).APIFY_TOKEN;
  // Не retryable: без токена повтор бессмысленен. Значение токена в сообщение не попадает.
  if (!token) throw new ScrapeTransportError("APIFY_TOKEN не задан", false);
  return token;
}

/**
 * Запуск актора синхронно и получение элементов датасета (сырой JSON).
 * Токен — в заголовке Authorization, не в URL, чтобы не попал в логи прокси.
 * Ник уже провалидирован вызывающим (`^[a-z0-9._]{1,30}$`).
 */
export function createApifyFetcher(options: ApifyFetcherOptions = {}) {
  return async function fetchRawProfile(username: string): Promise<unknown> {
    const token = options.token ?? readToken();
    const fetchImpl = options.fetchImpl ?? fetch;
    const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?timeout=${ACTOR_TIMEOUT_SECONDS}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        // Актор сам отдаёт только последние посты профиля; больше 24 мы всё равно режем в маппинге.
        body: JSON.stringify({ usernames: [username] }),
        signal: AbortSignal.timeout(options.abortAfterMs ?? ABORT_AFTER_MS),
      });
    } catch (error) {
      // Сеть, DNS, таймаут (AbortError/TimeoutError) — повторяем один раз.
      const name = error instanceof Error ? error.name : "unknown";
      throw new ScrapeTransportError(`сетевая ошибка или таймаут (${name})`, true);
    }

    if (!response.ok) {
      // 408 — таймаут run-sync, 429 и 5xx — временные. Остальные 4xx (401/402/403…) — нет.
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ScrapeTransportError(`Apify ответил ${response.status}`, retryable);
    }

    try {
      return await response.json();
    } catch {
      throw new ScrapeTransportError("Apify вернул не JSON", true);
    }
  };
}
