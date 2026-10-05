import type { ErrorCode, ProfileSnapshot as ProfileSnapshotType } from "@/contracts";
import { ProfileSnapshot } from "@/contracts";
import { createApifyFetcher, ScrapeTransportError } from "./apify";
import { putRawBlob, rawBlobKey } from "./blob";
import { mapProfile } from "./map";
import { RawDataset, RawErrorItem, RawProfile } from "./raw-schema";
import { createSnapshotRepository, type SnapshotRepository } from "./repository";

/** Кэш снимка профиля: повторная проверка того же ника в это окно не платит Apify. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Меньше постов — мало материала для шуток (roast-engine.md §2). */
export const MIN_POSTS = 6;

const USERNAME_RE = /^[a-z0-9._]{1,30}$/;

export type ScrapeErrorCode = Extract<
  ErrorCode,
  "invalid_url" | "profile_not_found" | "profile_private" | "not_enough_data" | "internal"
>;

/** Наружу — только это. Детали провайдера остаются в логах. */
export type ScrapeResult =
  | { ok: true; snapshot: ProfileSnapshotType; snapshotId: string; cached: boolean }
  | { ok: false; errorCode: ScrapeErrorCode };

/** Внешние зависимости шага; в тестах подменяются фейками. */
export type ScrapeDeps = {
  fetchRaw: (username: string) => Promise<unknown>;
  putRaw: (key: string, json: string) => Promise<void>;
  snapshots: SnapshotRepository;
  now: () => Date;
};

/** Реальные реализации создаются лениво: сборка и тесты не требуют токенов и БД. */
function defaultDeps(): ScrapeDeps {
  return {
    fetchRaw: createApifyFetcher(),
    putRaw: putRawBlob,
    snapshots: createSnapshotRepository(),
    now: () => new Date(),
  };
}

export function normalizeUsername(input: string): string | null {
  const normalized = input.trim().replace(/^@/, "").toLowerCase();
  // `.` и `..` проходят по regex, но в Blob-ключе это сегменты пути: у Instagram ник так не начинается,
  // не заканчивается точкой и не содержит двух точек подряд.
  if (!USERNAME_RE.test(normalized)) return null;
  if (normalized.startsWith(".") || normalized.endsWith(".") || normalized.includes(".."))
    return null;
  return normalized;
}

/** В лог — только тип события, без значений из ответа провайдера и без токена. */
function logFailure(event: string, detail?: unknown) {
  const text =
    detail instanceof ScrapeTransportError
      ? detail.message
      : detail instanceof Error
        ? detail.name
        : "";
  console.error(`[scrape] ${event}${text ? `: ${text}` : ""}`);
}

type Classified =
  | { kind: "profile"; snapshot: ProfileSnapshotType }
  | { kind: "error"; errorCode: "profile_not_found" | "profile_private" }
  /** Ответ не прошёл схему — можно повторить. */
  | { kind: "invalid" };

function classify(raw: unknown, username: string, fetchedAt: Date): Classified {
  const dataset = RawDataset.safeParse(raw);
  if (!dataset.success) return { kind: "invalid" };
  const first = dataset.data[0];
  if (first === undefined) return { kind: "error", errorCode: "profile_not_found" };

  if (RawErrorItem.safeParse(first).success) {
    return { kind: "error", errorCode: "profile_not_found" };
  }

  const profile = RawProfile.safeParse(first);
  if (!profile.success) return { kind: "invalid" };
  if (profile.data.private === true) return { kind: "error", errorCode: "profile_private" };

  try {
    return { kind: "profile", snapshot: mapProfile(profile.data, username, fetchedAt) };
  } catch {
    return { kind: "invalid" };
  }
}

function guardrail(snapshot: ProfileSnapshotType): ScrapeErrorCode | null {
  if (snapshot.isPrivate) return "profile_private";
  const noText =
    snapshot.biography.trim() === "" && snapshot.posts.every((p) => p.caption.trim() === "");
  if (snapshot.posts.length < MIN_POSTS || noText) return "not_enough_data";
  return null;
}

function finish(snapshot: ProfileSnapshotType, snapshotId: string, cached: boolean): ScrapeResult {
  const blocked = guardrail(snapshot);
  return blocked ? { ok: false, errorCode: blocked } : { ok: true, snapshot, snapshotId, cached };
}

/**
 * Шаг `scrape`: Apify → `ProfileSnapshot`, сырой ответ в private Blob, кэш 24 ч.
 * Идемпотентен: повтор в пределах 24 ч берёт кэш и не вызывает Apify.
 * Порядок записи: Blob, затем БД (сбой Blob — в БД ничего не пишем).
 *
 * TODO(cost-log): перед `fetchRaw` проверить дневной потолок трат на Apify
 * (roast-engine.md §8); после вызова записать стоимость. Лимиты на проверки — в `profile-check`.
 */
export async function scrapeProfile(
  igUsername: string,
  deps: ScrapeDeps = defaultDeps(),
): Promise<ScrapeResult> {
  // Ник идёт в URL актора и в Blob-ключ: проверяем до любого внешнего вызова.
  const username = normalizeUsername(igUsername);
  if (!username) return { ok: false, errorCode: "invalid_url" };

  try {
    const since = new Date(deps.now().getTime() - CACHE_TTL_MS);
    const cachedRow = await deps.snapshots.findFresh(username, since);
    if (cachedRow) {
      const parsed = ProfileSnapshot.safeParse(cachedRow.data);
      if (parsed.success) return finish(parsed.data, cachedRow.id, true);
      logFailure("кэш: снимок не прошёл схему, перезапрашиваем");
    }

    // Одна попытка + один ретрай (сеть, 5xx, таймаут, невалидная схема).
    let result: Classified | null = null;
    let raw: unknown;
    let fetchedAt = deps.now();
    for (let attempt = 1; attempt <= 2 && result === null; attempt++) {
      try {
        raw = await deps.fetchRaw(username);
      } catch (error) {
        logFailure(`запрос к Apify, попытка ${attempt}`, error);
        if (error instanceof ScrapeTransportError && !error.retryable) break;
        continue;
      }
      fetchedAt = deps.now();
      const classified = classify(raw, username, fetchedAt);
      if (classified.kind === "invalid") {
        logFailure(`ответ Apify не прошёл схему, попытка ${attempt}`);
        continue;
      }
      result = classified;
    }

    if (result === null) return { ok: false, errorCode: "internal" };
    if (result.kind === "error") return { ok: false, errorCode: result.errorCode };

    const key = rawBlobKey(username, fetchedAt);
    await deps.putRaw(key, JSON.stringify(raw));
    const snapshotId = await deps.snapshots.insert({
      igUsername: username,
      data: result.snapshot,
      rawBlobKey: key,
    });
    return finish(result.snapshot, snapshotId, false);
  } catch (error) {
    logFailure("сбой хранилища", error);
    return { ok: false, errorCode: "internal" };
  }
}
