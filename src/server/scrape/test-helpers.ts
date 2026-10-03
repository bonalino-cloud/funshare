import { vi } from "vitest";
import type { ProfileSnapshot } from "@/contracts";
import type { ScrapeDeps } from "./scrape-profile";

export const NOW = new Date("2026-10-03T12:00:00.000Z");

/** Фейки всех внешних зависимостей. Реальных сетевых вызовов тесты не делают. */
export function makeDeps(overrides: { fetchRaw?: ScrapeDeps["fetchRaw"] } = {}) {
  const stored: { igUsername: string; data: ProfileSnapshot; rawBlobKey: string }[] = [];
  const deps = {
    fetchRaw: vi.fn<ScrapeDeps["fetchRaw"]>(overrides.fetchRaw ?? (async () => [])),
    putRaw: vi.fn<ScrapeDeps["putRaw"]>(async () => {}),
    snapshots: {
      findFresh: vi.fn<ScrapeDeps["snapshots"]["findFresh"]>(async () => null),
      insert: vi.fn<ScrapeDeps["snapshots"]["insert"]>(async (row) => {
        stored.push(row);
      }),
    },
    now: () => NOW,
  } satisfies ScrapeDeps;
  return { deps, stored };
}
