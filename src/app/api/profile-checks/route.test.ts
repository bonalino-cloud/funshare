import { expect, it } from "vitest";
import { MAX_DURATION_SECONDS } from "@/server/profile-check/config";
import { maxDuration } from "./route";

// Next читает maxDuration статически и не принимает импорт, поэтому в маршруте литерал: сверяем.
it("maxDuration маршрута совпадает с конфигом, от которого считаются дедлайны", () => {
  expect(maxDuration).toBe(MAX_DURATION_SECONDS);
});
