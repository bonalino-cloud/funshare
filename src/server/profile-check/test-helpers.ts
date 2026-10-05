import { NextRequest } from "next/server";
import { vi } from "vitest";
import type { CheckedProfile } from "@/contracts";
import type { AnalyzeStepResult } from "../analyze";
import { makeProfile } from "../analyze/test-helpers";
import { hashValue } from "../hash";
import type { ScrapeResult } from "../scrape";
import type { HandlerDeps } from "./handlers";
import type { NewProfileCheck, ProfileCheckRepository, ProfileCheckRow } from "./repository";

export const NOW = new Date("2026-10-03T12:00:00.000Z");
export const TOKEN = "A".repeat(43);
export const OTHER_TOKEN = "B".repeat(43);
export const ownerHash = (token: string) => hashValue("owner", token);

/** Репозиторий в памяти с теми же правилами, что в SQL: обновляем только `checking`. */
export function makeRepo() {
  const rows = new Map<string, ProfileCheckRow>();
  let n = 0;
  const closeable = (id: string) => rows.get(id)?.status === "checking";

  const repo = {
    insert: vi.fn<ProfileCheckRepository["insert"]>(async (row: NewProfileCheck) => {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      rows.set(id, {
        id,
        igUsername: row.igUsername,
        status: row.status,
        errorCode: row.status === "failed" ? row.errorCode : null,
        hint: row.status === "checking" ? row.hint : null,
        snapshotId: row.status === "ok" ? row.snapshotId : null,
        profile: row.status === "ok" ? row.profile : null,
        ownerTokenHash: row.ownerTokenHash,
        checkedAt: row.status === "checking" ? null : row.checkedAt,
        createdAt: NOW,
        updatedAt: NOW,
      });
      return id;
    }),
    get: vi.fn<ProfileCheckRepository["get"]>(async (id) => rows.get(id) ?? null),
    findCached: vi.fn<ProfileCheckRepository["findCached"]>(async (igUsername, since) => {
      const hits = [...rows.values()].filter(
        (r) =>
          r.igUsername === igUsername &&
          r.checkedAt !== null &&
          r.checkedAt >= since &&
          (r.status === "ok" || (r.status === "failed" && r.errorCode === "minor_detected")),
      );
      return (
        hits.sort((a, b) => (b.checkedAt?.getTime() ?? 0) - (a.checkedAt?.getTime() ?? 0))[0] ??
        null
      );
    }),
    setHint: vi.fn<ProfileCheckRepository["setHint"]>(async (id, hint) => {
      const row = rows.get(id);
      if (!row || !closeable(id)) return false;
      rows.set(id, { ...row, hint });
      return true;
    }),
    complete: vi.fn<ProfileCheckRepository["complete"]>(async (id, r) => {
      const row = rows.get(id);
      if (!row || !closeable(id)) return false;
      rows.set(id, { ...row, status: "ok", hint: null, ...r });
      return true;
    }),
    fail: vi.fn<ProfileCheckRepository["fail"]>(async (id, errorCode, checkedAt) => {
      const row = rows.get(id);
      if (!row || !closeable(id)) return false;
      rows.set(id, { ...row, status: "failed", hint: null, errorCode, checkedAt });
      return true;
    }),
  } satisfies ProfileCheckRepository;
  return { repo, rows };
}

export const okScrape = (): ScrapeResult => ({
  ok: true,
  snapshot: makeProfile(),
  snapshotId: "snap-1",
  cached: false,
});
export const okAnalyze = (): AnalyzeStepResult => ({
  ok: true,
  persona: {} as never, // пайплайн досье не читает: оно уже сохранено шагом
  promptVersion: "v1",
  model: "test",
  cached: false,
});

/** Что отдаёт фейковый копировщик аватара: наш Blob, не Instagram. */
export const OUR_AVATAR_URL = "https://blob.example.com/avatars/abc";

export const EXPECTED_PROFILE: CheckedProfile = {
  username: "anya.travels",
  displayName: "Аня Морозова",
  avatarUrl: OUR_AVATAR_URL,
  postsCount: 8,
};

/** Фейки всех зависимостей; задачи фона копятся в `tasks` и запускаются тестом через `flush`. */
export function makeHandlerDeps(over: Partial<HandlerDeps> = {}) {
  const { repo, rows } = makeRepo();
  const tasks: (() => Promise<void>)[] = [];
  const scrape = vi.fn<HandlerDeps["pipeline"]["scrape"]>(async () => okScrape());
  const analyze = vi.fn<HandlerDeps["pipeline"]["analyze"]>(async () => okAnalyze());
  const copyAvatar = vi.fn<HandlerDeps["pipeline"]["copyAvatar"]>(async () => OUR_AVATAR_URL);
  const check = vi.fn<HandlerDeps["limiter"]["check"]>(async () => true);
  const deps: HandlerDeps = {
    repo,
    limiter: { check },
    schedule: (task) => void tasks.push(task),
    pipeline: { scrape, analyze, copyAvatar },
    now: () => NOW,
    secureCookie: true,
    ...over,
  };
  const flush = async () => {
    while (tasks.length > 0) await tasks.shift()?.();
  };
  return { deps, repo, rows, scrape, analyze, copyAvatar, check, tasks, flush };
}

export function post(body: unknown, init: { token?: string; ip?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.token) headers.set("cookie", `ownerToken=${init.token}`);
  if (init.ip) headers.set("x-real-ip", init.ip);
  return new NextRequest("http://localhost/api/profile-checks", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function get(id: string, token?: string) {
  return new NextRequest(`http://localhost/api/profile-checks/${id}`, {
    headers: token ? { cookie: `ownerToken=${token}` } : {},
  });
}
