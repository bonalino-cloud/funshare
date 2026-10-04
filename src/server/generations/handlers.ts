import type { NextRequest } from "next/server";
import {
  GenerationCreated,
  GenerationRequest,
  GenerationStatus,
  type ErrorCode,
  type Tier,
} from "@/contracts";
import { hashValue, isOwnerToken, sameHash } from "../hash";
import {
  DuplicateOrderError,
  createOrder,
  guardPromoAttempt,
  releaseOrder,
  type OrderRepository,
} from "../orders";
import { TierUnavailableError } from "../pricing";
import { OWNER_COOKIE, RESULT_CACHE_TTL_MS } from "../profile-check/config";
import { clientIp } from "../profile-check/handlers";
import type { ProfileCheckRepository } from "../profile-check/repository";
import type { PromoGuard } from "../ratelimit/promo";
import type { GenerationRepository } from "./repository";

export type GenerationsHandlerDeps = {
  repo: GenerationRepository;
  /** Проверки профиля: нужно только чтение. */
  profiles: Pick<ProfileCheckRepository, "get">;
  orders: OrderRepository;
  guard: PromoGuard;
  /** Запуск конвейера (сейчас заглушка, см. `workflow.ts`). */
  startWorkflow: (generationId: string) => Promise<void>;
  newId: () => string;
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

/** Чужое, несуществующее и «без cookie» неотличимы (как в GET /api/profile-checks/:id). */
const notFound = () => errorResponse("internal", 404);

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

/**
 * Поджог-источник для переноса шуток (roast-engine §1): тот же владелец, тот же профиль, Поджог
 * (тариф 1), завершён. Любое несоответствие → `null`: ссылку молча игнорируем, ничего не сообщаем.
 */
async function validTrialId(
  repo: GenerationRepository,
  trialId: string | undefined,
  tier: Tier,
  ownerTokenHash: string,
  igUsername: string,
): Promise<string | null> {
  if (trialId === undefined || tier === 1) return null;
  const trial = await repo.get(trialId);
  const ok =
    trial !== null &&
    trial.tier === 1 &&
    trial.status === "ready" &&
    trial.igUsername === igUsername &&
    sameHash(trial.ownerTokenHash, ownerTokenHash);
  return ok ? trialId : null;
}

/** Освободить заказ (правило 2). Сбой не должен ломать ответ и сам не бросает. */
async function releaseSafely(deps: GenerationsHandlerDeps, orderId: string): Promise<void> {
  try {
    await releaseOrder(deps.orders, orderId, deps.now());
  } catch (error) {
    // Заказ завис в `free`: нужен ручной разбор по логам. Пользователю это не показываем.
    console.error(`[generations] заказ ${orderId} не освобождён: ${errorName(error)}`);
  }
}

/** Что нужно знать после создания заказа, чтобы довести генерацию или откатить заказ. */
type Placed = { generationId: string; orderId: string };

/**
 * Проверка профиля → заказ → строка генерации. Порядок записи: заказ раньше строки.
 * `orders.generationId` без FK, поэтому заказ можно создать до строки; отказ заказа
 * (`payment_required`, `free_used`, `promo_invalid`, пауза) не оставляет НИЧЕГО: ни генерации, ни
 * заказа, ни списанного кода. Если после заказа не записалась строка — заказ освобождается здесь же.
 */
async function place(
  body: GenerationRequest,
  who: { ownerTokenHash: string; ipHash: string },
  deps: GenerationsHandlerDeps,
): Promise<Placed | Response> {
  const check = await deps.profiles.get(body.profileCheckId);
  if (!check || !sameHash(check.ownerTokenHash, who.ownerTokenHash)) return notFound();
  // Проверка этого владельца, но к генерации не годна. Только `errorCode`, без подробностей.
  if (check.status === "checking") return errorResponse("internal", 409);
  if (check.status === "failed") return errorResponse(check.errorCode ?? "internal", 409);
  const freshSince = deps.now().getTime() - RESULT_CACHE_TTL_MS;
  if (!check.checkedAt || check.checkedAt.getTime() < freshSince) {
    return errorResponse("profile_not_found", 410);
  }

  const trialGenerationId = await validTrialId(
    deps.repo,
    body.trialGenerationId,
    body.tier,
    who.ownerTokenHash,
    check.igUsername,
  );

  const generationId = deps.newId();
  const run = () =>
    createOrder(deps.orders, {
      generationId,
      tier: body.tier,
      promoCode: body.promoCode,
      ...who,
      now: deps.now(),
    });

  let result;
  if (body.promoCode === undefined) {
    result = await run();
  } else {
    // Лимит на перебор кодов (правило 6): пауза → 429, неверный код пишется в счётчик.
    const guarded = await guardPromoAttempt(
      deps.guard,
      { ipHash: who.ipHash, ownerHash: who.ownerTokenHash },
      run,
    );
    if (guarded.limited) return errorResponse("rate_limited");
    result = guarded.result;
  }
  // `ok` у `createOrder` всегда итог 0: платный итог он отдаёт как `payment_required` без заказа.
  if (!result.ok) return errorResponse(result.errorCode);
  const orderId = result.order.id;

  try {
    await deps.repo.insert({
      id: generationId,
      igUsername: check.igUsername,
      mode: body.mode,
      kind: body.kind,
      profileCheckId: check.id,
      tier: body.tier,
      level: body.level,
      extraFacts: body.extraFacts ?? [],
      trialGenerationId,
      ...who,
    });
  } catch (error) {
    console.error(`[generations] строка не записана: ${errorName(error)}`);
    await releaseSafely(deps, orderId);
    return errorResponse("internal");
  }
  return { generationId, orderId };
}

/** POST /api/generations */
export async function createGeneration(
  request: NextRequest,
  deps: GenerationsHandlerDeps,
): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse("internal", 400);
  }
  const parsed = GenerationRequest.safeParse(json);
  if (!parsed.success) return errorResponse("internal", 400);

  // Без cookie владение проверкой не доказать: тот же ответ, что на чужую проверку.
  const cookie = request.cookies.get(OWNER_COOKIE)?.value;
  if (!isOwnerToken(cookie)) return notFound();

  let who: { ownerTokenHash: string; ipHash: string };
  try {
    who = {
      ownerTokenHash: hashValue("owner", cookie),
      ipHash: hashValue("ip", clientIp(request.headers)),
    };
  } catch (error) {
    console.error(`[generations] соль хэша недоступна: ${errorName(error)}`);
    return errorResponse("internal", 503);
  }

  let placed: Placed | Response;
  try {
    placed = await place(parsed.data, who, deps);
  } catch (error) {
    if (error instanceof TierUnavailableError) return errorResponse("internal", 400);
    if (error instanceof DuplicateOrderError) {
      console.error("[generations] заказ на этот id уже есть");
      return errorResponse("internal", 409);
    }
    // Недоступный лимитер (Redis) и сбой БД: закрыто, без деталей наружу.
    const unavailable = errorName(error) === "RateLimitUnavailableError";
    console.error(`[generations] POST не выполнен: ${errorName(error)}`);
    return errorResponse("internal", unavailable ? 503 : 500);
  }
  if (placed instanceof Response) return placed;

  try {
    await deps.startWorkflow(placed.generationId);
  } catch (error) {
    console.error(`[generations] конвейер не запущен: ${errorName(error)}`);
    try {
      await deps.repo.markFailed(placed.generationId, "internal", deps.now());
    } catch (markError) {
      console.error(`[generations] failed не записан: ${errorName(markError)}`);
    }
    await releaseSafely(deps, placed.orderId);
    return errorResponse("internal", 503);
  }

  return Response.json(GenerationCreated.parse({ id: placed.generationId }), {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * GET /api/generations/:id — только владелец. Чужой, несуществующий и «без cookie» id — одинаковый
 * 404. Ответ строго через `GenerationStatus`: `errorCode` только при failed, `artifactSlug` только
 * при ready.
 */
export async function getGeneration(
  request: NextRequest,
  id: string,
  deps: Pick<GenerationsHandlerDeps, "repo">,
): Promise<Response> {
  const cookie = request.cookies.get(OWNER_COOKIE)?.value;
  if (!isOwnerToken(cookie)) return notFound();

  let ownerTokenHash: string;
  try {
    ownerTokenHash = hashValue("owner", cookie);
  } catch (error) {
    console.error(`[generations] соль хэша недоступна: ${errorName(error)}`);
    return errorResponse("internal", 503);
  }

  try {
    const row = await deps.repo.get(id);
    if (!row || !sameHash(row.ownerTokenHash, ownerTokenHash)) return notFound();

    const candidate = {
      id: row.id,
      status: row.status,
      ...(row.status === "failed" ? { errorCode: row.errorCode ?? "internal" } : {}),
      ...(row.status === "ready" && row.artifactSlug ? { artifactSlug: row.artifactSlug } : {}),
      updatedAt: row.updatedAt.toISOString(),
    };
    const status = GenerationStatus.safeParse(candidate);
    if (!status.success) {
      console.error("[generations] строка не прошла контракт ответа");
      return errorResponse("internal");
    }
    return Response.json(status.data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(`[generations] GET не выполнен: ${errorName(error)}`);
    return errorResponse("internal");
  }
}
