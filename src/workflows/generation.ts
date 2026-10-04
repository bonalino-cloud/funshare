import { defaultPipelineDeps, failGeneration, runWrite } from "@/server/generations/pipeline";

/**
 * Конвейер генерации (roast-engine §3). СКЕЛЕТ: шаги-заглушки меняют статус и пишут `stepTimings`.
 * Запускается только из `startWorkflow` (сервер после записи строки и заказа); публичного входа нет.
 *
 * Сейчас останавливается на `awaiting_selection`: `ready` без артефакта контракт не допускает.
 * TODO(be/p1-selection): здесь же ждать выбор шуток (`createHook` с токеном `selection:<id>`,
 * resume только из авторизованного роута владельца), затем `runDraw` (Поджог пропускает) и сборка.
 */
export async function generationWorkflow(generationId: string) {
  "use workflow";

  let written: boolean;
  try {
    written = await writeStep(generationId);
  } catch {
    // Ретраи шага исчерпаны (или FatalError): закрываем генерацию и возвращаем код/пробу.
    await failStep(generationId);
    return { generationId, outcome: "failed" as const };
  }
  // `false`: строку уже закрыли снаружи (POST пометил `failed`, хотя запуск успел уйти в очередь).
  return { generationId, outcome: written ? ("awaiting_selection" as const) : ("closed" as const) };
}

async function writeStep(generationId: string): Promise<boolean> {
  "use step";
  try {
    return await runWrite(defaultPipelineDeps(), generationId);
  } catch (error) {
    // Только имя ошибки: тексты провайдеров и профилей в логи не пишем.
    console.error(`[workflow] write не выполнен: ${error instanceof Error ? error.name : ""}`);
    throw error;
  }
}

async function failStep(generationId: string): Promise<void> {
  "use step";
  await failGeneration(defaultPipelineDeps(), generationId);
}
