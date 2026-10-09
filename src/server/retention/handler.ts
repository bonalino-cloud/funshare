import { createHmac, timingSafeEqual } from "node:crypto";
import { parseServerEnv } from "../env";
import { avatarStore, rawStore, retentionDb } from "./adapters";
import {
  hasFailure,
  retentionLogLine,
  runRetention,
  safeErrorName,
  type RetentionDeps,
  type RetentionResult,
} from "./run";

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Короче — считаем, что секрета нет: перебор короткого секрета дешевле. */
export const CRON_SECRET_MIN_LENGTH = 16;

/**
 * Сравнение за постоянное время: оба значения сначала сводятся HMAC к 32 байтам, поэтому не
 * утекает и длина секрета.
 */
export function secretMatches(provided: string, expected: string): boolean {
  const key = "retention-cron";
  const a = createHmac("sha256", key).update(provided).digest();
  const b = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(a, b);
}

/** `Authorization: Bearer ${CRON_SECRET}` — так Vercel Cron подписывает вызов. Нет секрета → отказ всегда. */
export function isAuthorized(request: Request, source: Record<string, string | undefined>) {
  let secret: string | undefined;
  try {
    secret = parseServerEnv(source).CRON_SECRET;
  } catch {
    return false;
  }
  if (!secret || secret.length < CRON_SECRET_MIN_LENGTH) return false;
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return secretMatches(header.slice(prefix.length), secret);
}

export const defaultRetentionDeps: RetentionDeps = {
  db: retentionDb,
  rawStore,
  avatarStore,
  now: () => new Date(),
};

export async function handleRetention(
  request: Request,
  deps: RetentionDeps = defaultRetentionDeps,
  source: Record<string, string | undefined> = process.env,
): Promise<Response> {
  if (!isAuthorized(request, source)) {
    return new Response(null, { status: 401, headers: NO_STORE });
  }
  let result: RetentionResult;
  try {
    result = await runRetention(deps);
  } catch (error) {
    // Шаги ловят свои сбои сами; сюда попадёт только непредвиденное.
    console.error(`[retention] прогон упал: ${safeErrorName(error)}`);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
  const failed = hasFailure(result);
  const line = retentionLogLine(result);
  if (failed) console.error(line);
  else console.log(line);
  return Response.json(
    { ok: !failed, ...result },
    { status: failed ? 500 : 200, headers: NO_STORE },
  );
}
