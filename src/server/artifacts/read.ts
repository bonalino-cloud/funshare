import type { NextRequest } from "next/server";
import { Artifact, CheckedProfile } from "@/contracts";
import { hashValue, isOwnerToken, sameHash } from "../hash";
import { OWNER_COOKIE } from "../profile-check/config";
import type { ArtifactReadRepository, ArtifactReadRow } from "./repository";

/**
 * Публичное чтение артефакта по `slug` (без авторизации). Наружу идёт только `Artifact`: он собирается
 * заново из публичных полей и проходит схему, так что сырой профиль, `ownerTokenHash`, трассы и
 * `jokeCardId` попасть в ответ не могут.
 */

/** Результат для страницы и роута: штатные исходы — значения, не исключения. */
export type ArtifactResult =
  { status: "found"; artifact: Artifact } | { status: "not_found" } | { status: "gone" };

export type ArtifactReadDeps = { repo: ArtifactReadRepository };

/** Как `newSlug()`: 10 символов из 62. Другой формат отсекаем до похода в БД. */
const SLUG_RE = /^[A-Za-z0-9]{10}$/;
export const isArtifactSlug = (value: string): boolean => SLUG_RE.test(value);

/** Строка в БД есть, но не собирается в `Artifact`: это поломка данных, а не «не найдено». */
export class ArtifactCorruptError extends Error {
  constructor() {
    super("artifact row does not match contract");
    this.name = "ArtifactCorruptError";
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

const isHttps = (url: string) => URL.canParse(url) && new URL(url).protocol === "https:";

/** `isOwner`: cookie с токеном владельца. Нет соли хэша — гостевой вид, а не ошибка (чтение публичное). */
function isOwnerOf(row: ArtifactReadRow, ownerToken: string | null | undefined): boolean {
  if (!isOwnerToken(ownerToken ?? undefined)) return false;
  try {
    return sameHash(row.ownerTokenHash, hashValue("owner", ownerToken as string));
  } catch (error) {
    console.error(`[artifacts] хэш владельца недоступен: ${errorName(error)}`);
    return false;
  }
}

/** Картинка с не-https URL (javascript:, data:) отбрасывается: защита, даже если запись когда-то испортят. */
function safeImages(images: unknown): unknown {
  if (!Array.isArray(images)) return images;
  return images.filter(
    (i: unknown) =>
      typeof i === "object" &&
      i !== null &&
      "url" in i &&
      typeof i.url === "string" &&
      isHttps(i.url),
  );
}

/**
 * `subject`: сохранённый при публикации; у старых строк (`null`) — из проверки профиля и генерации.
 * Аватар не-https отбрасывается в обоих случаях.
 */
function subjectOf(row: ArtifactReadRow): unknown {
  if (row.subject !== null && typeof row.subject === "object") {
    const stored = row.subject as { avatarUrl?: unknown };
    const avatarUrl =
      typeof stored.avatarUrl === "string" && isHttps(stored.avatarUrl) ? stored.avatarUrl : null;
    return { ...row.subject, avatarUrl };
  }
  const profile = CheckedProfile.safeParse(row.profile);
  const username = profile.success ? profile.data.username : row.igUsername;
  const avatarUrl = profile.success ? profile.data.avatarUrl : null;
  return {
    username,
    displayName: profile.success ? profile.data.displayName : username,
    avatarUrl: avatarUrl !== null && isHttps(avatarUrl) ? avatarUrl : null,
  };
}

/** Собирает `Artifact` из строки. Не прошла схему — `ArtifactCorruptError`. */
export function toArtifact(row: ArtifactReadRow, isOwner: boolean): Artifact {
  const parsed = Artifact.safeParse({
    slug: row.slug,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    subject: subjectOf(row),
    mode: row.mode,
    content: row.content,
    images: safeImages(row.images),
    // Картинки к шуткам рисует шаг `draw` (be/p2-draw): хранилища под них пока нет.
    ...(row.kind === "roast_v1" ? { punchImages: [] } : {}),
    isOwner,
  });
  if (!parsed.success) throw new ArtifactCorruptError();
  return parsed.data;
}

/**
 * `ownerToken` — значение cookie (страница берёт его из `cookies()`), нужно только для `isOwner`.
 * Невалидный и несуществующий slug неотличимы (`not_found`); при невалидном в БД не ходим.
 * Ошибка БД и битая строка (`ArtifactCorruptError`) — исключения: это не штатный исход.
 */
export async function readArtifact(
  deps: ArtifactReadDeps,
  slug: string,
  ownerToken?: string | null,
): Promise<ArtifactResult> {
  if (!isArtifactSlug(slug)) return { status: "not_found" };
  const row = await deps.repo.findBySlug(slug);
  if (!row) return { status: "not_found" };
  if (row.deletedAt !== null) return { status: "gone" };
  return { status: "found", artifact: toArtifact(row, isOwnerOf(row, ownerToken)) };
}

/**
 * Кэш. Ответ зависит от cookie (`isOwner`), поэтому `private` (общий кэш/CDN не хранит и не
 * путает владельца с гостем) и `Vary: Cookie`. `no-cache`: браузер может хранить, но перед
 * показом спрашивает сервер, поэтому удаление (410) срабатывает сразу, а не через TTL. Контент
 * иммутабелен, но ответ — пара килобайт, переспрос дешёвый. Ошибки — `no-store`.
 */
const FOUND_HEADERS = { "cache-control": "private, no-cache", vary: "Cookie" };
const ERROR_HEADERS = { "cache-control": "no-store" };

const errorBody = (status: number) =>
  Response.json({ errorCode: "internal" }, { status, headers: ERROR_HEADERS });

/**
 * GET /api/artifacts/:slug. 200 — `Artifact`, 404 — нет/невалидный slug, 410 — удалён.
 * Тело ошибок — `{ errorCode: "internal" }`: FE-клиент читает `errorCode`, статус берёт из HTTP.
 */
export async function getArtifactResponse(
  request: NextRequest,
  slug: string,
  deps: ArtifactReadDeps,
): Promise<Response> {
  try {
    const result = await readArtifact(deps, slug, request.cookies.get(OWNER_COOKIE)?.value);
    if (result.status === "not_found") return errorBody(404);
    if (result.status === "gone") return errorBody(410);
    return Response.json(result.artifact, { headers: FOUND_HEADERS });
  } catch (error) {
    console.error(`[artifacts] GET не выполнен: ${errorName(error)}`);
    return errorBody(500);
  }
}
