import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let client: ReturnType<typeof createClient> | undefined;

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан (vercel env pull .env.local)");
  return drizzle(neon(url), { schema });
}

/** Ленивое подключение: сборка и тесты не требуют DATABASE_URL. */
export function db() {
  client ??= createClient();
  return client;
}

export { schema };
