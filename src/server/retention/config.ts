/** Срок хранения сырых данных (инвариант 5): всё старше этого срока удаляет ежедневный Cron. */
export const RETENTION_DAYS = 30;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Строк БД за один DELETE. Одна пачка — один короткий запрос, а не долгая блокировка. */
export const DB_BATCH_SIZE = 500;
/** Потолок пачек БД на шаг за прогон: остаток доделает следующий прогон. */
export const DB_MAX_BATCHES = 40;

/** Размер страницы `list` (максимум SDK). */
export const BLOB_LIST_PAGE = 1000;
/** Потолок страниц `list` на префикс за прогон: ограничивает просмотр, а не удаление. */
export const BLOB_MAX_PAGES = 50;
/** Файлов за один `del` / одну очистку URL в БД. */
export const BLOB_DELETE_BATCH = 100;
/** Потолок удалённых файлов на префикс за прогон. */
export const BLOB_MAX_DELETED = 2000;

/** Должно совпадать с литералом `maxDuration` в маршруте (Next читает его статически). */
export const MAX_DURATION_SECONDS = 300;
/** Бюджет прогона: оставляем запас до `maxDuration`, чтобы ответ и лог успели уйти. */
export const TIME_BUDGET_MS = (MAX_DURATION_SECONDS - 45) * 1000;

/** Префиксы Blob. `art/` не трогаем: это иллюстрации живых артефактов. */
export const RAW_PREFIX = "raw/";
export const AVATAR_PREFIX = "avatars/";
