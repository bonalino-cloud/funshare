import { start } from "workflow/api";
import { generationWorkflow } from "@/workflows/generation";

/**
 * Запуск конвейера генерации (Vercel Workflow). Контракт: вызывается один раз после записи строки
 * `generations` и заказа; если бросает, вызывающий закрывает генерацию `failed/internal` и
 * освобождает заказ. Повторный запуск того же id безвреден: шаги условные и идемпотентные.
 */
export async function startWorkflow(generationId: string): Promise<void> {
  await start(generationWorkflow, [generationId]);
}
