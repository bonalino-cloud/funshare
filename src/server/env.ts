import { z } from "zod";

// Серверные переменные окружения. Все необязательны на этапе каркаса:
// каждая задача делает свою переменную обязательной, когда начинает её использовать.
const serverEnvSchema = z.object({
  DATABASE_URL: z.url().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  APIFY_TOKEN: z.string().min(1).optional(),
  KIE_API_KEY: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Пустая строка в .env означает «не задано».
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  return serverEnvSchema.parse(cleaned);
}
