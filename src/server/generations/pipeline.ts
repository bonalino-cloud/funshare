import { releaseOrder, createOrderRepository, type OrderRepository } from "../orders";
import { runWriteStep } from "../roast/write";
import { createGenerationRepository, type GenerationRepository } from "./repository";

/**
 * Логика шагов конвейера (roast-engine §3) отдельно от движка workflow: обычные функции, их можно
 * тестировать с репозиторием в памяти. Обёртки `"use step"` лежат в `src/workflows/generation.ts`.
 *
 * Правила каждого шага: переход условный (только из ожидаемого статуса, одной SQL-командой вместе с
 * `stepTimings`), поэтому повтор после рестарта не дублирует и не откатывает статус назад.
 *
 * `write` пишет кандидатов (`roast/write`); `draw` пока заглушка. `ready` здесь не ставится
 * никогда: по контракту `ready` без `artifactSlug` недопустим, а артефакта шаги не создают.
 */
export type PipelineDeps = {
  repo: Pick<GenerationRepository, "get" | "advance" | "markFailed">;
  orders: Pick<OrderRepository, "orderIdFor" | "release">;
  now: () => Date;
  /** Тело шага `write`: кандидаты в хранилище. Бросает `WriteFailedError`, если слабое не выдаём. */
  write: (generationId: string) => Promise<void>;
};

/** Боевые зависимости. Лениво на каждый вызов шага: сборка и тесты не требуют БД. */
export function defaultPipelineDeps(): PipelineDeps {
  return {
    repo: createGenerationRepository(),
    orders: createOrderRepository(),
    now: () => new Date(),
    write: (generationId) => runWriteStep(generationId),
  };
}

/**
 * `queued → writing → awaiting_selection`: писатель и судья, кандидаты в `punch_candidates`.
 * `true` — строка в `awaiting_selection`; `false` — генерация уже закрыта (`failed`) или её нет.
 *
 * Повтор после рестарта: статус `writing` не двигается назад, а тело шага идемпотентно (готовые
 * кандидаты не пишутся заново и модель не зовётся). Закрытую снаружи генерацию (`failed` из
 * POST) не обрабатываем: платных вызовов нет.
 */
export async function runWrite(deps: PipelineDeps, generationId: string): Promise<boolean> {
  const started = await deps.repo.advance(generationId, {
    from: ["queued"],
    to: "writing",
    start: ["write"],
    now: deps.now(),
  });
  const status = started ? "writing" : (await deps.repo.get(generationId))?.status;
  if (status !== "writing") return status === "awaiting_selection";

  await deps.write(generationId);

  const moved = await deps.repo.advance(generationId, {
    from: ["writing"],
    to: "awaiting_selection",
    finish: ["write"],
    // Время ожидания человека видно в тех же таймингах; `finishedAt` проставит шаг выбора.
    start: ["awaiting_selection"],
    now: deps.now(),
  });
  if (moved) return true;
  // Повтор после полного прохода или генерация уже закрыта (например, `failed` из POST).
  return (await deps.repo.get(generationId))?.status === "awaiting_selection";
}

export type DrawResult = "skipped" | "done";

/**
 * `awaiting_selection → drawing`. У Поджога (тариф 1) картинок нет: шаг пропускается, статус не
 * меняется (§7.1a). Заглушка: рисовать пока нечего.
 * TODO(be/p1-selection): вызывается после выбора шуток, он же закрывает тайминг `awaiting_selection`.
 */
export async function runDraw(deps: PipelineDeps, generationId: string): Promise<DrawResult> {
  const row = await deps.repo.get(generationId);
  if (!row || row.tier === 1) return "skipped";
  await deps.repo.advance(generationId, {
    from: ["awaiting_selection"],
    to: "drawing",
    start: ["draw"],
    now: deps.now(),
  });
  // TODO(be/p2-draw): картинки по выбранным шуткам.
  await deps.repo.advance(generationId, {
    from: ["drawing"],
    to: "drawing",
    finish: ["draw"],
    now: deps.now(),
  });
  return "done";
}

/**
 * Провал после ретраев: `failed` + `internal`, затем освободить заказ (код или проба возвращаются).
 * Идемпотентно: повтор снова ставит `failed` и снова зовёт `release`, а он второй раз ничего не
 * меняет. Генерацию в `ready` не трогаем (артефакт есть) и заказ тоже оставляем.
 */
export async function failGeneration(deps: PipelineDeps, generationId: string): Promise<void> {
  const failed = await deps.repo.markFailed(generationId, "internal", deps.now());
  if (!failed) return;
  const orderId = await deps.orders.orderIdFor(generationId);
  if (orderId) await releaseOrder(deps.orders, orderId, deps.now());
}
