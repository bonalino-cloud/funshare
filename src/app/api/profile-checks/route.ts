import { after, type NextRequest } from "next/server";
import { createProfileCheck, defaultDeps } from "@/server/profile-check";

// Фон (`after`) живёт в пределах maxDuration маршрута: scrape + analyze в худшем случае долгие.
// Литерал обязателен (Next читает его статически) и должен совпадать с MAX_DURATION_SECONDS
// в src/server/profile-check/config.ts: от него считаются дедлайн фона и срок «зависшей» проверки.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return createProfileCheck(
    request,
    defaultDeps((task) => after(task)),
  );
}
