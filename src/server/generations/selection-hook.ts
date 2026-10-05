/**
 * Токен хука, на котором workflow ждёт выбор шуток. Токен не секрет и не защита (его можно
 * вычислить из id): resume делает только `POST …/selection` после проверки владельца, публичного
 * входа в хук нет (`createHook`, не `createWebhook`).
 */
export const selectionHookToken = (generationId: string) => `selection:${generationId}`;

/** Сигнал workflow «выбор принят». Сам выбор в хук не передаётся: он уже в БД, сервер читает оттуда. */
export type SelectionSignal = { accepted: true };
