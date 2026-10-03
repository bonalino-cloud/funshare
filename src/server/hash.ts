import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseServerEnv } from "./env";

/**
 * Хэши IP и ownerToken (инвариант 6): в БД и в ключах Redis лежит только результат этой функции.
 * HMAC с серверной солью, потому что пространство IPv4 перебирается за минуты — голый sha256 не защита.
 * Запасная соль лежит в репозитории, то есть она публичная: хэш IP с ней обратим перебором. Поэтому
 * она только для dev и тестов, а в production без `HASH_SALT` хэш не считается — вызывающий
 * отказывает (как с лимитером без Redis). Соль задаётся в Vercel env до боевого запуска.
 */
const FALLBACK_SALT = "funshare-hash-fallback-v1";

export class HashSaltMissingError extends Error {
  constructor() {
    super("HASH_SALT не задан");
    this.name = "HashSaltMissingError";
  }
}

function salt(): string {
  const configured = parseServerEnv(process.env).HASH_SALT;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new HashSaltMissingError();
  return FALLBACK_SALT;
}

/** `purpose` разводит пространства: хэш IP никогда не совпадёт с хэшем токена. */
export function hashValue(purpose: "ip" | "owner", value: string): string {
  return createHmac("sha256", salt()).update(`${purpose}:${value}`).digest("hex");
}

/** Сравнение хэшей за постоянное время. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 256 бит случайности в base64url: 43 символа. */
export function newOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

const OWNER_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Чужой формат (подделанная cookie) считаем отсутствием токена, а не ошибкой. */
export function isOwnerToken(value: string | undefined): value is string {
  return value !== undefined && OWNER_TOKEN_RE.test(value);
}
