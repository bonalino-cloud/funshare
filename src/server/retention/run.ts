import {
  AVATAR_PREFIX,
  BLOB_DELETE_BATCH,
  BLOB_LIST_PAGE,
  BLOB_MAX_DELETED,
  BLOB_MAX_PAGES,
  DB_BATCH_SIZE,
  DB_MAX_BATCHES,
  RAW_PREFIX,
  RETENTION_MS,
  TIME_BUDGET_MS,
} from "./config";

export type BlobObject = { url: string; pathname: string; uploadedAt: Date };

/** Одно хранилище Blob (токен уже внутри): public для аватаров, private для сырья. */
export type RetentionBlobStore = {
  list(input: {
    prefix: string;
    cursor?: string;
    limit: number;
  }): Promise<{ blobs: BlobObject[]; cursor?: string; hasMore: boolean }>;
  /** Актуальный `uploadedAt` файла; `null`, если файла уже нет. */
  head(url: string): Promise<{ uploadedAt: Date } | null>;
  del(urls: string[]): Promise<void>;
};

export type RetentionDb = {
  /** Удаляет до `limit` трасс старше `cutoff`, возвращает сколько удалено. */
  deleteTraces(cutoff: Date, limit: number): Promise<number>;
  /** То же для `profile_snapshots` по `fetchedAt` (каскад и set null — на стороне БД). */
  deleteSnapshots(cutoff: Date, limit: number): Promise<number>;
  /** Ставит `avatarUrl: null` там, где он равен одному из `urls`. Возвращает число строк. */
  clearAvatarUrls(urls: string[]): Promise<number>;
};

export type RetentionDeps = {
  db: RetentionDb;
  /** Функции, чтобы нехватка токена одного хранилища роняла только свой шаг. */
  rawStore: () => RetentionBlobStore;
  avatarStore: () => RetentionBlobStore;
  now: () => Date;
};

export type StepResult = {
  deleted: number;
  /** Дошли до потолка или бюджета времени: остаток доделает следующий прогон. */
  truncated: boolean;
  /** Только `error.name`; `null` — шаг прошёл. */
  error: string | null;
};

export type RetentionResult = {
  traces: StepResult;
  snapshots: StepResult;
  raw: StepResult;
  avatars: StepResult & { cleared: number };
};

/** Граница срока: строго старше `cutoff` удаляем, ровно 30 дней — ещё храним. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_MS);
}

/** Имя ошибки для лога и ответа: короткое, без данных. */
export function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "Error";
  // Ошибки Blob SDK не задают `name` (он "Error"), но класс назван: `BlobServiceRateLimited` и т.п.
  const name = error.name === "Error" ? error.constructor.name : error.name;
  return /^[A-Za-z0-9_]{1,40}$/.test(name) ? name : "Error";
}

function emptyStep(): StepResult {
  return { deleted: 0, truncated: false, error: null };
}

export function hasFailure(result: RetentionResult): boolean {
  return [result.traces, result.snapshots, result.raw, result.avatars].some(
    (step) => step.error !== null,
  );
}

type Clock = { now: () => Date; deadline: number };

const timeIsUp = (clock: Clock) => clock.now().getTime() >= clock.deadline;

async function drainDb(
  deleteBatch: (cutoff: Date, limit: number) => Promise<number>,
  cutoff: Date,
  clock: Clock,
): Promise<StepResult> {
  const result = emptyStep();
  try {
    for (let batch = 0; ; batch += 1) {
      if (batch >= DB_MAX_BATCHES || timeIsUp(clock)) {
        result.truncated = true;
        break;
      }
      const deleted = await deleteBatch(cutoff, DB_BATCH_SIZE);
      result.deleted += deleted;
      if (deleted < DB_BATCH_SIZE) break;
    }
  } catch (error) {
    result.error = safeErrorName(error);
  }
  return result;
}

/**
 * Обходит префикс Blob и удаляет файлы старше `cutoff` по `uploadedAt`. Не дата в ключе: у
 * `uploadedAt` не нужен разбор имени, а у перезаписанного аватара он обновляется (свежая проверка
 * ника = свежий файл). `prepare` получает пачку старых URL и возвращает те, что можно удалять сейчас.
 */
async function sweepBlob(
  store: RetentionBlobStore,
  prefix: string,
  cutoff: Date,
  clock: Clock,
  prepare: (urls: string[]) => Promise<string[]>,
): Promise<StepResult> {
  const result = emptyStep();
  try {
    let cursor: string | undefined;
    for (let page = 0; ; page += 1) {
      if (page >= BLOB_MAX_PAGES || timeIsUp(clock)) {
        result.truncated = true;
        break;
      }
      const listed = await store.list({ prefix, cursor, limit: BLOB_LIST_PAGE });
      const old = listed.blobs
        .filter((b) => b.pathname.startsWith(prefix) && b.uploadedAt.getTime() < cutoff.getTime())
        .map((b) => b.url);
      for (let i = 0; i < old.length; i += BLOB_DELETE_BATCH) {
        if (result.deleted >= BLOB_MAX_DELETED || timeIsUp(clock)) {
          result.truncated = true;
          return result;
        }
        const urls = await prepare(old.slice(i, i + BLOB_DELETE_BATCH));
        if (urls.length > 0) {
          await store.del(urls);
          result.deleted += urls.length;
        }
      }
      if (!listed.hasMore || !listed.cursor) break;
      cursor = listed.cursor;
    }
  } catch (error) {
    result.error = safeErrorName(error);
  }
  return result;
}

/**
 * Ежедневная чистка (инвариант 5). Шаги независимы: сбой одного не отменяет остальные.
 * Идемпотентна: повторный и параллельный прогоны удаляют то, что осталось.
 */
export async function runRetention(deps: RetentionDeps): Promise<RetentionResult> {
  const startedAt = deps.now();
  const cutoff = retentionCutoff(startedAt);
  const clock: Clock = { now: deps.now, deadline: startedAt.getTime() + TIME_BUDGET_MS };

  const traces = await drainDb(deps.db.deleteTraces, cutoff, clock);
  const snapshots = await drainDb(deps.db.deleteSnapshots, cutoff, clock);

  let raw: StepResult;
  try {
    raw = await sweepBlob(deps.rawStore(), RAW_PREFIX, cutoff, clock, async (urls) => urls);
  } catch (error) {
    raw = { deleted: 0, truncated: false, error: safeErrorName(error) };
  }

  let cleared = 0;
  let headCutShort = false;
  let avatars: StepResult;
  try {
    const store = deps.avatarStore();
    avatars = await sweepBlob(store, AVATAR_PREFIX, cutoff, clock, async (urls) => {
      // Файл мог быть перезаписан после `list` (новая проверка того же ника): сверяем свежий
      // `uploadedAt` и такой файл не трогаем. Проверка недоступна — тоже не трогаем.
      const stale: string[] = [];
      for (const url of urls) {
        // До 100 `head` подряд, у каждого свои повторы SDK: бюджет сверяем и внутри пачки.
        if (timeIsUp(clock)) {
          headCutShort = true;
          break;
        }
        try {
          const head = await store.head(url);
          if (head !== null && head.uploadedAt.getTime() < cutoff.getTime()) stale.push(url);
        } catch {
          // пропускаем: следующий прогон попробует снова
        }
      }
      if (stale.length === 0) return [];
      // Сначала БД, потом файл: если `del` упадёт, артефакт уже показывает букву ника, а
      // следующий прогон снова найдёт файл и удалит. Обратный порядок оставил бы битую картинку.
      cleared += await deps.db.clearAvatarUrls(stale);
      return stale;
    });
  } catch (error) {
    avatars = { deleted: 0, truncated: false, error: safeErrorName(error) };
  }

  if (headCutShort) avatars.truncated = true;
  return { traces, snapshots, raw, avatars: { ...avatars, cleared } };
}

/** Одна строка лога: только числа и имена ошибок, без ников, URL, ключей и текстов. */
export function retentionLogLine(result: RetentionResult): string {
  const part = (name: string, step: StepResult) =>
    `${name}=${step.deleted}${step.truncated ? "+" : ""}${step.error ? `(${step.error})` : ""}`;
  return [
    "[retention]",
    part("traces", result.traces),
    part("snapshots", result.snapshots),
    part("raw", result.raw),
    part("avatars", result.avatars),
    `avatarUrlsCleared=${result.avatars.cleared}`,
  ].join(" ");
}
