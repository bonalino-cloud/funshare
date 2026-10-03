import type { PromoGuard } from "../ratelimit/promo";
import type { RateLimitInput } from "../ratelimit";

/**
 * Обвязка лимита на перебор (правило 6) для любого места, где проверяется код: `/api/quotes` сейчас,
 * `/api/generations` в `be/p1-generations-api`. Пауза → `{ limited: true }`; иначе выполняем `run`, и
 * если код оказался неверным (`promo_invalid`) — записываем неверную попытку. Верные не тратят лимит.
 * Если лимитер недоступен, `enter` бросает: вызывающий отвечает 503.
 */
export async function guardPromoAttempt<T extends { ok: boolean; errorCode?: string }>(
  guard: PromoGuard,
  id: RateLimitInput,
  run: () => Promise<T>,
): Promise<{ limited: true } | { limited: false; result: T }> {
  if (!(await guard.enter(id))) return { limited: true };
  const result = await run();
  if (!result.ok && result.errorCode === "promo_invalid") await guard.fail(id);
  return { limited: false, result };
}
