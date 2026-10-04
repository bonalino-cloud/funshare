/**
 * Запуск конвейера генерации. СЕЙЧАС ЗАГЛУШКА: до be/p1-workflow-skeleton строка остаётся в
 * `queued`. Контракт: вызывается один раз после записи строки `generations` и заказа; если бросает,
 * вызывающий закрывает генерацию `failed/internal` и освобождает заказ.
 */
export async function startWorkflow(generationId: string): Promise<void> {
  void generationId;
}
