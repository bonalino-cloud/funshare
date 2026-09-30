import type { ErrorCode } from "@/contracts";

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
