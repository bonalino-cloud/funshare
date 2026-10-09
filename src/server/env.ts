import { z } from "zod";

// Серверные переменные окружения. Все необязательны на этапе каркаса:
// каждая задача делает свою переменную обязательной, когда начинает её использовать.
const serverEnvSchema = z.object({
  DATABASE_URL: z.url().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  // Токен ПРИВАТНОГО Blob-store для сырья скрейпа (подключён с префиксом BLOB_RAW). Только он, без запасных.
  BLOB_RAW_READ_WRITE_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  APIFY_TOKEN: z.string().min(1).optional(),
  KIE_API_KEY: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  // Upstash из Vercel Marketplace кладёт в env именно эти имена; переименовывать их не нужно.
  KV_REST_API_URL: z.url().optional(),
  KV_REST_API_TOKEN: z.string().min(1).optional(),
  // Секрет для хэшей IP и ownerToken (инвариант 6). Без него хэш работает с запасной солью.
  HASH_SALT: z.string().min(16).optional(),
  // Секрет Vercel Cron: заголовок `Authorization: Bearer <секрет>` на /api/cron/*. Без него маршруты Cron
  // отвечают 401. Длину (от 16) проверяет маршрут Cron, а не схема: короткий секрет не должен ронять
  // разбор env у всего бэкенда.
  CRON_SECRET: z.string().optional(),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Пустая строка в .env означает «не задано».
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  return serverEnvSchema.parse(cleaned);
}

/** Доступ к Redis. Принимаем обе пары имён; явные `UPSTASH_REDIS_*` приоритетнее `KV_REST_API_*`. */
export function redisCredentials(env: ServerEnv): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}
