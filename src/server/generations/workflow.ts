import { resumeHook, start } from "workflow/api";
import { generationWorkflow } from "@/workflows/generation";
import { selectionHookToken, type SelectionSignal } from "./selection-hook";

/**
 * Запуск конвейера генерации (Vercel Workflow). Контракт: вызывается один раз после записи строки
 * `generations` и заказа; если бросает, вызывающий закрывает генерацию `failed/internal` и
 * освобождает заказ. Повторный запуск того же id безвреден: шаги условные и идемпотентные.
 */
export async function startWorkflow(generationId: string): Promise<void> {
  await start(generationWorkflow, [generationId]);
}

/**
 * Разбудить workflow после принятого выбора. Зовётся ТОЛЬКО из `POST …/selection` после проверки
 * владельца: `resumeHook` сам не проверяет, кто зовёт. Бросает, если хука нет (workflow завершён)
 * или запись не удалась; вызывающий отвечает 503, повтор того же выбора разбудит ещё раз.
 */
export async function resumeSelection(generationId: string): Promise<void> {
  await resumeHook<SelectionSignal>(selectionHookToken(generationId), { accepted: true });
}
