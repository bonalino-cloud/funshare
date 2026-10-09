import { handleRetention } from "@/server/retention";

// Литерал обязателен (Next читает его статически) и должен совпадать с MAX_DURATION_SECONDS
// в src/server/retention/config.ts: от него считается бюджет времени прогона.
export const maxDuration = 300;

// Vercel Cron вызывает GET с `Authorization: Bearer ${CRON_SECRET}` (читает Request, поэтому не кэшируется).
export async function GET(request: Request) {
  return handleRetention(request);
}
