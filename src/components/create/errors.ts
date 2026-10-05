import type { ErrorCode } from "@/contracts";
import { ApiError, toErrorCode } from "@/lib/client/api";
import type { InputIssue } from "@/lib/client/instagram";

/**
 * Код ошибки → текст для человека (business/tone-of-voice.md §4.5).
 * Формула: что случилось + что делать. Коды и ответы API — только в логи.
 */
export const ERROR_TEXT: Record<ErrorCode, { what: string; next: string }> = {
  invalid_url: {
    what: "Это не похоже на ссылку на Instagram.",
    next: "Нужно что-то вроде instagram.com/username",
  },
  profile_not_found: {
    what: "Такого профиля нет.",
    next: "Проверь ник, может, там точка вместо подчёркивания",
  },
  profile_private: {
    what: "Профиль закрыт, а мы не взламываем.",
    next: "Открой его на минуту или попробуй другой",
  },
  not_enough_data: { what: "Слишком мало постов, жарить нечего.", next: "Нужен профиль поживее" },
  minor_detected: {
    what: "Похоже, владельцу нет 16. Таких не жарим.",
    next: "Попробуй другой профиль",
  },
  rate_limited: { what: "Ты слишком быстрый.", next: "Подожди минуту и давай ещё" },
  free_used: { what: "Поджог уже был.", next: "Бери Кострище" },
  promo_invalid: { what: "Такого слова нет.", next: "Проверь буквы" },
  payment_required: { what: "Оплата скоро.", next: "Есть волшебное слово?" },
  internal: { what: "У нас что-то сломалось.", next: "Уже чиним, попробуй через пару минут" },
};

export function errorLine(code: ErrorCode): string {
  const t = ERROR_TEXT[code];
  return `${t.what} ${t.next}`;
}

type Line = { what: string; next: string };

/** На экране генерации «Ещё раз» продолжает опрос: заказ уже создан, прожарка не потеряется. */
const OFFLINE_POLLING: Line = {
  what: "Пропала связь.",
  next: "Проверь интернет и нажми «Ещё раз», прожарка не потеряется",
};
/** На старте ответ мог потеряться уже после создания заказа: обещать нечего. */
const OFFLINE_START: Line = {
  what: "Пропала связь, и мы не знаем, дошёл ли запуск.",
  next: "Проверь интернет и попробуй ещё раз",
};

/** Один код `internal` на разные причины: тут различаем их по HTTP-статусу. */
const GENERATION_GONE: Line = {
  what: "Эта прожарка открывается только там, где её запускали.",
  next: "Открой ссылку на том устройстве или сделай новую",
};
const CHECK_STALE: Line = {
  what: "Проверка профиля устарела.",
  next: "Проверь профиль заново",
};

function lineFor(error: unknown, offline: Line, byStatus: Partial<Record<number, Line>>): string {
  if (error instanceof TypeError) {
    // Сетевой обрыв и программная ошибка в catch неотличимы: след в консоли оставляем
    console.error(error);
    return `${offline.what} ${offline.next}`;
  }
  const special = error instanceof ApiError ? byStatus[error.status] : undefined;
  if (special) return `${special.what} ${special.next}`;
  return errorLine(toErrorCode(error));
}

/** Ошибка на экране генерации. 404: чужая ссылка или потерянная cookie, а не поломка у нас. */
export function generationErrorLine(error: unknown): string {
  return lineFor(error, OFFLINE_POLLING, { 404: GENERATION_GONE });
}

/** Ошибка при запуске генерации. 410: проверка профиля старше 24 ч, а не «профиля нет». */
export function startErrorLine(error: unknown): string {
  return lineFor(error, OFFLINE_START, { 410: CHECK_STALE });
}

/** Подсказка под полем, пока ссылка не ушла на сервер. Для `incomplete` молчим. */
const INPUT_HINT: Record<Exclude<InputIssue, "incomplete">, { what: string; next: string }> = {
  not_instagram: { what: "Это не Instagram.", next: "Нужно что-то вроде instagram.com/username" },
  not_profile: {
    what: "Это ссылка на пост, а не на профиль.",
    next: "Открой профиль и скопируй его ссылку",
  },
  bad_username: {
    what: "В нике что-то лишнее.",
    next: "Только латиница, цифры, точка и подчёркивание, до 30 знаков",
  },
};

export function inputHint(issue: InputIssue): string | undefined {
  if (issue === "incomplete") return undefined;
  const t = INPUT_HINT[issue];
  return `${t.what} ${t.next}`;
}
