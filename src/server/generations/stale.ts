import type { GenerationStatusCode } from "@/contracts";
import { releaseOrder, type OrderRepository } from "../orders";
import type { GenerationRepository, StaleCutoffs } from "./repository";

/**
 * Сторож зависших генераций (roast-engine §3, «Надёжность»). Если провалился и шаг провала, умер
 * workflow (деплой, лимит времени) или не дошёл запуск, строка навсегда остаётся в рабочем
 * статусе: человек видит вечный лоудер, а заказ, проба и промокод не возвращаются.
 *
 * Сторож закрывает такую строку тем же исходом, что `failGeneration` (`failed/internal`, затем
 * `releaseOrder`), но только если строка давно не двигалась. Пороги ниже выведены из реальных лимитов
 * конвейера с запасом: закрыть живую генерацию хуже, чем подержать мёртвую лишние минуты. Даже при
 * ошибке порога вреда нет: проснувшийся workflow на закрытой строке получает `false` от `advance`
 * (статус `failed` не в `from`) и платных вызовов не делает.
 */

/** Лимит одного шага: функция Fluid на Hobby живёт до 300 с (комеди-движок режет себя на 225 с). */
export const STEP_MAX_MS = 300_000;
/** Попыток шага: первая и 3 повтора (по умолчанию Workflow, `maxRetries = 3`). */
export const STEP_ATTEMPTS = 4;
/**
 * Пауза между повторами: после ошибки Workflow повторяет через 1 с, но попытку, убитую по лимиту
 * функции, перевыдаёт очередь VQS с отступом до 900 с (`@workflow/core` runtime/constants). Поэтому
 * `write` отмечает жизнь в начале КАЖДОЙ попытки (`runWrite`): порог `writing` перекрывает одну
 * попытку и худшую паузу перед следующей (300 + 900 с = 20 мин), а не сумму всех попыток.
 */
export const RETRY_GAP_MS = 60_000;
/** Худшее время одного шага со всеми повторами: 4 × 300 с + 3 × 60 с = 23 мин. */
export const STEP_WINDOW_MS = STEP_ATTEMPTS * STEP_MAX_MS + (STEP_ATTEMPTS - 1) * RETRY_GAP_MS;
/** Запас сверх расчёта: холодный старт, медленная очередь платформы. */
export const STALE_MARGIN_MS = 5 * 60_000;

/**
 * Сколько строка может не двигаться (`updatedAt`) в каждом рабочем статусе, мс.
 * - `queued`: запуск ушёл в очередь, первый шаг должен стартовать через секунды. Расчёта по лимитам
 *   нет, 10 мин с запасом на сбои очереди; опоздавший запуск на закрытой строке ничего не делает.
 * - `writing`: один шаг `write` со всеми повторами + запас = 28 мин. Внутри попытки `updatedAt`
 *   не двигается (вызовы модели и учёт стоимости его не трогают), но каждая попытка начинается с
 *   отметки жизни, так что тот же порог покрывает и убитую попытку с паузой очереди до 900 с.
 * - после выбора (`drawing` и `awaiting_selection` с принятым выбором): `draw` и `assemble` —
 *   два шага подряд, оба со всеми повторами + запас = 51 мин. Сегодня `draw` заглушка, а `assemble`
 *   один SQL, так что реально это секунды; запас рассчитан на картинки (be/p2-draw).
 */
export const STALE_AFTER_MS = {
  queued: 10 * 60_000,
  writing: STEP_WINDOW_MS + STALE_MARGIN_MS,
  afterSelection: 2 * STEP_WINDOW_MS + STALE_MARGIN_MS,
} as const;

/**
 * `awaiting_selection` без принятого выбора НЕ закрывается: сколько ждать человека и что делать с
 * оплаченным заказом, решает продукт. Cron только считает, сколько таких стоят дольше этого срока.
 */
export const WAITING_REPORT_AFTER_MS = 24 * 60 * 60_000;

/** Потолок строк за один прогон Cron (остаток доделает следующий) и за один подсчёт «сирот». */
export const SWEEP_LIMIT = 100;

export function staleCutoffs(now: Date): StaleCutoffs {
  const before = (ms: number) => new Date(now.getTime() - ms);
  return {
    queued: before(STALE_AFTER_MS.queued),
    writing: before(STALE_AFTER_MS.writing),
    afterSelection: before(STALE_AFTER_MS.afterSelection),
  };
}

/**
 * Дешёвая предпроверка по уже прочитанной строке, чтобы GET не слал UPDATE каждой живой генерации.
 * Окончательное решение принимает SQL (`failStale`): для `awaiting_selection` он ещё смотрит,
 * принят ли выбор.
 */
export function maybeStale(row: { status: GenerationStatusCode; updatedAt: Date }, now: Date) {
  const limit =
    row.status === "queued"
      ? STALE_AFTER_MS.queued
      : row.status === "writing"
        ? STALE_AFTER_MS.writing
        : row.status === "drawing" || row.status === "awaiting_selection"
          ? STALE_AFTER_MS.afterSelection
          : null;
  return limit !== null && now.getTime() - row.updatedAt.getTime() > limit;
}

export type StaleDeps = {
  repo: Pick<GenerationRepository, "failStale" | "countWaitingSelection">;
  orders: Pick<OrderRepository, "orderIdFor" | "release" | "listOrphanOrderIds">;
  now: () => Date;
};

/**
 * Освободить заказ закрытой генерации. `released` — освободили сейчас; `none` — заказа нет или он
 * уже освобождён; `failed` — сбой БД, дочистит следующий прогон.
 */
async function releaseFor(
  deps: StaleDeps,
  generationId: string,
): Promise<"released" | "none" | "failed"> {
  try {
    const orderId = await deps.orders.orderIdFor(generationId);
    if (orderId === null) return "none";
    return (await releaseOrder(deps.orders, orderId, deps.now())) ? "released" : "none";
  } catch {
    return "failed";
  }
}

/**
 * Ленивое закрытие одной генерации (GET). `true` — закрыли именно этим вызовом. Если освободить
 * заказ не вышло, строка всё равно закрыта (человек перестаёт ждать), а заказ дочистит Cron
 * (`listOrphanOrderIds`). Бросает только при сбое самого закрытия.
 */
export async function closeStaleGeneration(deps: StaleDeps, id: string): Promise<boolean> {
  const closed = await deps.repo.failStale({
    cutoffs: staleCutoffs(deps.now()),
    now: deps.now(),
    limit: 1,
    id,
  });
  if (closed.length === 0) return false;
  if ((await releaseFor(deps, id)) === "failed") {
    console.error("[generations] заказ зависшей генерации не освобождён, дочистит Cron");
  }
  return true;
}

export type StaleSweep = {
  /** Закрыто зависших строк. */
  closed: number;
  /** Освобождено заказов (у закрытых сейчас и «сирот» прошлых прогонов). */
  released: number;
  /** Освобождений, которые не вышли (сбой БД): повторит следующий прогон. */
  releaseFailures: number;
  /** Ждут выбор человека дольше `WAITING_REPORT_AFTER_MS` (только считаем). */
  waiting: number;
  /** Дошли до потолка: остаток доделает следующий прогон. */
  truncated: boolean;
};

/**
 * Подметание пачкой (Cron): закрыть зависшие, освободить их заказы, дочистить заказы, оставшиеся у
 * уже закрытых генераций, посчитать долгое ожидание выбора. Идемпотентно и безопасно при двух
 * сторожах сразу: закрытие условное, `release` второй раз заказ не трогает.
 */
export async function sweepStaleGenerations(
  deps: StaleDeps,
  limit: number = SWEEP_LIMIT,
): Promise<StaleSweep> {
  const now = deps.now();
  const closed = await deps.repo.failStale({ cutoffs: staleCutoffs(now), now, limit });

  // Заказы закрытых генераций: только что закрытых и тех, у кого освобождение не дошло раньше
  // (сбой между `failed` и `release` в конвейере, в POST или в GET). Один путь на оба случая.
  const orphans = await deps.orders.listOrphanOrderIds(limit);
  let released = 0;
  let releaseFailures = 0;
  for (const orderId of orphans) {
    try {
      if (await releaseOrder(deps.orders, orderId, now)) released += 1;
    } catch {
      releaseFailures += 1;
    }
  }

  const waiting = await deps.repo.countWaitingSelection(
    new Date(now.getTime() - WAITING_REPORT_AFTER_MS),
  );
  return {
    closed: closed.length,
    released,
    releaseFailures,
    waiting,
    truncated: closed.length >= limit || orphans.length >= limit,
  };
}
