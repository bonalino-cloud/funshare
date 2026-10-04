import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  CheckedProfile,
  ProfileCheckCreated,
  ProfileCheckRequest,
  ProfileCheckStatus,
  type ErrorCode,
} from "@/contracts";
import { hashValue, isOwnerToken, newOwnerToken, sameHash } from "../hash";
import type { RateLimiter } from "../ratelimit";
import {
  HINTS,
  OWNER_COOKIE,
  OWNER_COOKIE_MAX_AGE_SECONDS,
  RESULT_CACHE_TTL_MS,
  STALE_AFTER_MS,
} from "./config";
import { parseInstagramInput } from "./parse-input";
import type { ProfileCheckRepository, ProfileCheckRow } from "./repository";
import { runProfileCheck, safeAvatarUrl, type PipelineDeps } from "./run";

export type HandlerDeps = {
  repo: ProfileCheckRepository;
  limiter: RateLimiter;
  /** Запуск фона после ответа: в маршруте это `after` из next/server. */
  schedule: (task: () => Promise<void>) => void;
  pipeline: Omit<PipelineDeps, "repo" | "now">;
  now: () => Date;
  secureCookie: boolean;
};

/** Ошибка наружу: только `errorCode` (контракт), без деталей. Ответы личные — не кэшируем. */
function errorResponse(status: number, errorCode: ErrorCode): Response {
  return Response.json({ errorCode }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * IP клиента. На Vercel `x-real-ip` и `x-forwarded-for` выставляет платформа и перезаписывает
 * присланные клиентом значения, поэтому им можно верить. Из `x-forwarded-for` берём последний
 * элемент: его добавил ближайший доверенный прокси, а первый может быть подделан клиентом.
 * Нет заголовков — общий ключ «unknown»: лучше общий лимит на всех, чем отсутствие лимита.
 * IPv6 сводим к сети /64: её выдают одному абоненту целиком, и без этого каждый адрес из неё
 * получал бы свой лимит.
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",");
  const ip = real || forwarded?.[forwarded.length - 1]?.trim();
  if (!ip) return "unknown";
  return ip.includes(":") ? (ipv6Prefix64(ip) ?? ip) : ip;
}

/** `2001:db8:1:2::5` → `2001:db8:1:2::/64`; IPv4 внутри IPv6 (`::ffff:1.2.3.4`) → `1.2.3.4`. */
export function ipv6Prefix64(ip: string): string | null {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr);
  if (mapped?.[1]) return mapped[1];
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

/** Поле есть и это строка: значит, схема отказала по длине — это ввод человека. */
const HAS_URL_STRING = z.object({ instagramUrl: z.string() });

/**
 * Тело запроса → данные, `"invalid_request"` (не JSON, нет поля, не строка — ошибка формы
 * запроса) или `"invalid_url"` (строка есть, но пустая или слишком длинная — ошибка ввода человека).
 */
async function readBody(
  request: Request,
): Promise<ProfileCheckRequest | "invalid_request" | "invalid_url"> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return "invalid_request";
  }
  const parsed = ProfileCheckRequest.safeParse(json);
  if (parsed.success) return parsed.data;
  return HAS_URL_STRING.safeParse(json).success ? "invalid_url" : "invalid_request";
}

/** Строка БД → ответ GET. Проходит `ProfileCheckStatus.parse` (инвариант 20); битая строка → `null`. */
function toStatus(row: ProfileCheckRow): ProfileCheckStatus | null {
  const base = { id: row.id, updatedAt: row.updatedAt.toISOString() };
  let candidate: unknown;
  if (row.status === "ok") {
    const profile = CheckedProfile.safeParse(row.profile);
    if (!profile.success) return null;
    // jsonb не доверяем: схема пропускает любой URL, а на экран идёт только http(s).
    candidate = {
      ...base,
      status: "ok",
      profile: { ...profile.data, avatarUrl: safeAvatarUrl(profile.data.avatarUrl) },
    };
  } else if (row.status === "failed") {
    candidate = { ...base, status: "failed", errorCode: row.errorCode ?? "internal" };
  } else {
    candidate = { ...base, status: "checking", ...(row.hint ? { hint: row.hint } : {}) };
  }
  const result = ProfileCheckStatus.safeParse(candidate);
  return result.success ? result.data : null;
}

/** POST /api/profile-checks */
export async function createProfileCheck(
  request: NextRequest,
  deps: HandlerDeps,
): Promise<Response> {
  const body = await readBody(request);
  if (typeof body === "string") return errorResponse(400, body);
  const username = parseInstagramInput(body.instagramUrl);
  if (username === null) return errorResponse(400, "invalid_url");

  const cookieToken = request.cookies.get(OWNER_COOKIE)?.value;
  const existingToken = isOwnerToken(cookieToken) ? cookieToken : null;
  const ownerToken = existingToken ?? newOwnerToken();
  let ownerTokenHash: string;
  let ipHash: string;

  // Лимит раньше любой работы с БД и внешними сервисами. Лимитер или соль хэша недоступны → закрыто.
  try {
    ownerTokenHash = hashValue("owner", ownerToken);
    ipHash = hashValue("ip", clientIp(request.headers));
    const allowed = await deps.limiter.check({
      ipHash,
      ownerHash: existingToken ? ownerTokenHash : null,
    });
    if (!allowed) return errorResponse(429, "rate_limited");
  } catch (error) {
    console.error(
      `[profile-check] лимитер или соль недоступны: ${error instanceof Error ? error.name : ""}`,
    );
    return errorResponse(503, "internal");
  }

  let id: string;
  let started = false;
  try {
    const cached = await deps.repo.findCached(
      username,
      new Date(deps.now().getTime() - RESULT_CACHE_TTL_MS),
    );
    const base = { igUsername: username, ownerTokenHash, ipHash };
    const cachedProfile = cached ? CheckedProfile.safeParse(cached.profile) : null;

    if (cached?.status === "ok" && cachedProfile?.success && cached.checkedAt) {
      // Новая запись этому владельцу с результатом из кэша: чужой `id` не отдаём никогда.
      id = await deps.repo.insert({
        ...base,
        status: "ok",
        snapshotId: cached.snapshotId,
        profile: cachedProfile.data,
        checkedAt: cached.checkedAt,
      });
    } else if (
      cached?.status === "failed" &&
      cached.errorCode === "minor_detected" &&
      cached.checkedAt
    ) {
      id = await deps.repo.insert({
        ...base,
        status: "failed",
        errorCode: "minor_detected",
        checkedAt: cached.checkedAt,
      });
    } else {
      id = await deps.repo.insert({ ...base, status: "checking", hint: HINTS.scrape });
      started = true;
    }
  } catch (error) {
    console.error(`[profile-check] БД недоступна: ${error instanceof Error ? error.name : ""}`);
    return errorResponse(500, "internal");
  }

  if (started) {
    const pipeline: PipelineDeps = { ...deps.pipeline, repo: deps.repo, now: deps.now };
    deps.schedule(() => runProfileCheck(id, username, pipeline));
  }

  const response = Response.json(ProfileCheckCreated.parse({ id }), {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
  if (!existingToken) {
    // Токен — секрет владельца: недоступен скрипту, не уходит по http, не шлётся с чужих сайтов.
    const cookie = [
      `${OWNER_COOKIE}=${ownerToken}`,
      "Path=/",
      `Max-Age=${OWNER_COOKIE_MAX_AGE_SECONDS}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(deps.secureCookie ? ["Secure"] : []),
    ].join("; ");
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

/**
 * GET /api/profile-checks/:id — только владелец. Чужой, несуществующий и «без cookie» id
 * неотличимы: везде 404 (не 403), чтобы не подтверждать существование чужой проверки.
 */
export async function getProfileCheck(
  request: NextRequest,
  id: string,
  deps: Pick<HandlerDeps, "repo" | "now">,
): Promise<Response> {
  const notFound = () => errorResponse(404, "internal");

  const cookieToken = request.cookies.get(OWNER_COOKIE)?.value;
  if (!isOwnerToken(cookieToken)) return notFound();

  try {
    let row = await deps.repo.get(id);
    if (!row || !sameHash(row.ownerTokenHash, hashValue("owner", cookieToken))) return notFound();

    // Зависшая проверка: функцию убили до записи результата. Закрываем, чтобы лоудер не крутился вечно.
    if (
      row.status === "checking" &&
      deps.now().getTime() - row.createdAt.getTime() > STALE_AFTER_MS
    ) {
      console.error("[profile-check] проверка зависла, закрываем как internal");
      await deps.repo.fail(id, "internal", deps.now());
      row = (await deps.repo.get(id)) ?? row;
    }

    const status = toStatus(row);
    if (status === null) {
      console.error("[profile-check] строка не прошла контракт ответа");
      return errorResponse(500, "internal");
    }
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(`[profile-check] GET не выполнен: ${error instanceof Error ? error.name : ""}`);
    return errorResponse(500, "internal");
  }
}
