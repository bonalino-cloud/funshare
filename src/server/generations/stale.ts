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
 *
 * Отдельный случай: `awaiting_selection`, где человек не принял выбор. Это не поломка, а брошенная
 * страница; её закрывает долгий порог (3 суток), чтобы проба и промокод не пропадали насовсем.
 * Выбор после закрытия не принимается (`submitSelection` требует статус `awaiting_selection`).
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
 * Отдельный порог `awaiting_selection` без принятого выбора: человек не вернулся. Решение Дениса
 * 20.10.2026, вариант «б»: через 3 суток без движения генерация закрывается `failed/internal` и
 * заказ освобождается (возвращаются бесплатная проба Поджога и промокод). Движением считается
 * только `updated_at`: приём выбора и переход в `awaiting_selection`; чтение кандидатов его не двигает.
 *
 * TODO(be/p4-billing): когда появятся платные заказы (`paid`), закрытие по этому порогу должно
 * делать ВОЗВРАТ денег, а не просто освобождение: `releaseOrder` платный заказ не трогает, так что
 * без возврата человек потеряет деньги за шутки, которых не увидел. До билинга платных генераций
 * нет (402 `payment_required`), значит закрываются только `free`/`created`.
 */
export const WAITING_SELECTION_STALE_MS = 3 * 24 * 60 * 60_000;

/**
 * Порог ОТЧЁТА, а не закрытия: сколько ждут выбор дольше суток (строка `awaitingOver24h` в логе
 * Cron). Закрытие ждёт 3 суток, так что счётчик показывает очередь «ждёт, но ещё не закрыта»:
 * 0 — никто не застрял, рост — люди уходят, не выбрав шутки. Прогон сначала закрывает, потом
 * считает, поэтому строки старше 3 суток в счётчик не попадают.
 */
export const WAITING_REPORT_AFTER_MS = 24 * 60 * 60_000;

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
 * - `awaiting_selection` без выбора: ждём человека, 3 суток (`WAITING_SELECTION_STALE_MS`).
 */
export const STALE_AFTER_MS = {
  queued: 10 * 60_000,
  writing: STEP_WINDOW_MS + STALE_MARGIN_MS,
  afterSelection: 2 * STEP_WINDOW_MS + STALE_MARGIN_MS,
  /** `awaiting_selection` без выбора: 3 суток (решение Дениса 20.10, вариант б). */
  awaitingSelection: WAITING_SELECTION_STALE_MS,
} as const;

/** Потолок строк за один прогон Cron (остаток доделает следующий) и за один подсчёт «сирот». */
export const SWEEP_LIMIT = 100;

export function staleCutoffs(now: Date): StaleCutoffs {
  const before = (ms: number) => new Date(now.getTime() - ms);
  return {
    queued: before(STALE_AFTER_MS.queued),
    writing: before(STALE_AFTER_MS.writing),
    afterSelection: before(STALE_AFTER_MS.afterSelection),
    waitingSelection: before(STALE_AFTER_MS.awaitingSelection),
  };
}

/**
 * Дешёвая предпроверка по уже прочитанной строке, чтобы GET не слал UPDATE каждой живой генерации.
 * Окончательное решение принимает SQL (`failStale`): для `awaiting_selection` он смотрит, принят ли
 * выбор, и выбирает порог (51 мин или 3 суток). Выбор в прочитанной строке не виден, поэтому
 * предпроверка берёт МЕНЬШИЙ порог: ложное «может быть» стоит одного холостого UPDATE (по id, 0 строк)
 * на GET ожидающей строки старше 51 мин; ложного «нет» быть не может.
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
  /** Ещё ждут выбор дольше `WAITING_REPORT_AFTER_MS`, но моложе порога закрытия (считаем после закрытия). */
  waiting: number;
  /** Дошли до потолка: остаток доделает следующий прогон. */
  truncated: boolean;
};

/**
 * Подметание пачкой (Cron): закрыть зависшие, освободить их заказы, дочистить заказы, оставшиеся у
 * уже закрытых генераций, посчитать оставшихся в долгом ожидании выбора. Идемпотентно и безопасно при двух
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
