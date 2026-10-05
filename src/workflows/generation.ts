import { FatalError, createHook } from "workflow";
import { AssembleFailedError, newSlug, runAssemble } from "@/server/generations/assemble";
import { createArtifactRepository } from "@/server/generations/artifact-repository";
import {
  defaultPipelineDeps,
  failGeneration,
  runDraw,
  runWrite,
} from "@/server/generations/pipeline";
import { createGenerationRepository } from "@/server/generations/repository";
import { selectionHookToken, type SelectionSignal } from "@/server/generations/selection-hook";
import { WriteFailedError } from "@/server/roast/write";

/**
 * Конвейер генерации (roast-engine §3): `write` → ожидание выбора шуток → `draw` (Поджог пропускает)
 * → сборка артефакта → `ready`. Шаги меняют статус и пишут `stepTimings`.
 * Запускается только из `startWorkflow` (сервер после записи строки и заказа); публичного входа нет.
 *
 * Выбор приходит через хук `selection:<id>`. Хук создаётся и регистрируется (`getConflict`) ДО
 * `write`, чтобы он уже был зарегистрирован, когда статус станет `awaiting_selection` (сигнал, пришедший раньше `await`,
 * не теряется). Резюмит его только `POST …/selection` после проверки владельца. В сигнале ничего
 * нет: выбор и его порядок лежат в БД, сборка читает их оттуда.
 */
export async function generationWorkflow(generationId: string) {
  "use workflow";

  using selection = createHook<SelectionSignal>({ token: selectionHookToken(generationId) });
  // `createHook` сам не регистрирует хук: без этого `await` шаг `write` может успеть поставить
  // `awaiting_selection` раньше регистрации, и быстрый POST получит HookNotFoundError (503).
  // Конфликт = токен держит другой запуск той же генерации: этот запуск ничего не трогает.
  if (await selection.getConflict()) return { generationId, outcome: "closed" as const };

  let written: boolean;
  try {
    written = await writeStep(generationId);
  } catch {
    // Ретраи шага исчерпаны (или FatalError): закрываем генерацию и возвращаем код/пробу.
    await failStep(generationId);
    return { generationId, outcome: "failed" as const };
  }
  // `false`: строку уже закрыли снаружи (POST пометил `failed`, хотя запуск успел уйти в очередь).
  if (!written) return { generationId, outcome: "closed" as const };

  // Пауза: человек выбирает шутки. Пока ждём, workflow не занимает вычислений.
  await selection;

  try {
    await drawStep(generationId);
    const outcome = await assembleStep(generationId);
    return { generationId, outcome };
  } catch {
    await failStep(generationId);
    return { generationId, outcome: "failed" as const };
  }
}

async function writeStep(generationId: string): Promise<boolean> {
  "use step";
  try {
    return await runWrite(defaultPipelineDeps(), generationId);
  } catch (error) {
    // Только имя ошибки: тексты провайдеров и профилей в логи не пишем.
    console.error(`[workflow] write не выполнен: ${error instanceof Error ? error.name : ""}`);
    // Слабый результат или битый вход повтор не исправит, а модель за повтор стоит денег.
    if (error instanceof WriteFailedError) throw new FatalError(`write: ${error.reason}`);
    throw error;
  }
}

async function drawStep(generationId: string): Promise<void> {
  "use step";
  await runDraw(defaultPipelineDeps(), generationId);
}

async function assembleStep(generationId: string): Promise<"ready" | "closed"> {
  "use step";
  try {
    return await runAssemble(
      {
        repo: createGenerationRepository(),
        artifacts: createArtifactRepository(),
        now: () => new Date(),
        newSlug,
      },
      generationId,
    );
  } catch (error) {
    console.error(`[workflow] assemble не выполнен: ${error instanceof Error ? error.name : ""}`);
    // Битый выбор или схема артефакта повтор не исправит.
    if (error instanceof AssembleFailedError) throw new FatalError(`assemble: ${error.reason}`);
    throw error;
  }
}

async function failStep(generationId: string): Promise<void> {
  "use step";
  await failGeneration(defaultPipelineDeps(), generationId);
}
