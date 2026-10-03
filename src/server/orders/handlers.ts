import type { NextRequest } from "next/server";
import { QuoteRequest, Pricing, type ErrorCode } from "@/contracts";
import { hashValue, isOwnerToken } from "../hash";
import { buildPricing, TierUnavailableError } from "../pricing";
import { clientIp } from "../profile-check/handlers";
import { OWNER_COOKIE } from "../profile-check/config";
import type { PromoGuard } from "../ratelimit/promo";
import { guardPromoAttempt } from "./guard";
import type { OrderRepository, Person } from "./repository";
import { isFreeTrialAvailable, quoteFor } from "./service";

export type OrdersHandlerDeps = {
  repo: OrderRepository;
  guard: PromoGuard;
  now: () => Date;
};

const STATUS: Partial<Record<ErrorCode, number>> = {
  promo_invalid: 400,
  free_used: 409,
  payment_required: 402,
  rate_limited: 429,
  internal: 500,
};

/** Ошибка наружу: только `errorCode` (контракт), без деталей. Ответы личные — не кэшируем. */
function errorResponse(errorCode: ErrorCode, status = STATUS[errorCode] ?? 500): Response {
  return Response.json({ errorCode }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Кто спрашивает: хэш cookie `ownerToken` (если есть; здесь её не выдаём, это делает проверка
 * профиля) и хэш IP. Нет соли хэша в production → бросает, вызывающий отвечает 503.
 */
function identify(request: NextRequest): Person {
  const cookie = request.cookies.get(OWNER_COOKIE)?.value;
  return {
    ownerTokenHash: isOwnerToken(cookie) ? hashValue("owner", cookie) : null,
    ipHash: hashValue("ip", clientIp(request.headers)),
  };
}

/** GET /api/pricing */
export async function getPricing(
  request: NextRequest,
  deps: Pick<OrdersHandlerDeps, "repo">,
): Promise<Response> {
  let person: Person;
  try {
    person = identify(request);
  } catch (error) {
    console.error(`[orders] соль хэша недоступна: ${error instanceof Error ? error.name : ""}`);
    return errorResponse("internal", 503);
  }
  try {
    const available = await isFreeTrialAvailable(deps.repo, person);
    return Response.json(Pricing.parse(buildPricing(available)), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error(`[orders] pricing не выполнен: ${error instanceof Error ? error.name : ""}`);
    return errorResponse("internal");
  }
}

/**
 * POST /api/quotes — считает цену и проверяет слово, ничего не тратит. Неверное слово любой
 * причины — один и тот же 400 `promo_invalid`; неверные попытки лимитируются (5 за 10 минут).
 */
export async function postQuote(request: NextRequest, deps: OrdersHandlerDeps): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse("internal", 400);
  }
  const body = QuoteRequest.safeParse(json);
  if (!body.success) return errorResponse("internal", 400);

  let person: Person;
  try {
    person = identify(request);
  } catch (error) {
    console.error(`[orders] соль хэша недоступна: ${error instanceof Error ? error.name : ""}`);
    return errorResponse("internal", 503);
  }

  const run = () => quoteFor(deps.repo, body.data, person, deps.now());
  try {
    let result;
    if (body.data.promoCode === undefined) {
      result = await run();
    } else {
      const guarded = await guardPromoAttempt(
        deps.guard,
        { ipHash: person.ipHash, ownerHash: person.ownerTokenHash },
        run,
      );
      if (guarded.limited) return errorResponse("rate_limited");
      result = guarded.result;
    }
    if (!result.ok) return errorResponse(result.errorCode);
    return Response.json(result.quote, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof TierUnavailableError) return errorResponse("internal", 400);
    // Недоступный лимитер (Redis) и сбой БД: закрыто, без деталей наружу.
    const unavailable = error instanceof Error && error.name === "RateLimitUnavailableError";
    console.error(`[orders] quotes не выполнен: ${error instanceof Error ? error.name : ""}`);
    return errorResponse("internal", unavailable ? 503 : 500);
  }
}
