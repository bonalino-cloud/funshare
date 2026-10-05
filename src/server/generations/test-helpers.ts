import { NextRequest } from "next/server";
import { vi } from "vitest";
import type { GenerationRequest } from "@/contracts";
import { makeGuard, makePromo, makeRepo as makeOrdersRepo } from "../orders/test-helpers";
import {
  EXPECTED_PROFILE,
  makeRepo as makeProfileRepo,
  ownerHash,
} from "../profile-check/test-helpers";
import type { NewProfileCheck } from "../profile-check/repository";
import type { StepTimings } from "../db/schema";
import type { GenerationsHandlerDeps } from "./handlers";
import type { GenerationRepository, GenerationRow, NewGeneration } from "./repository";

export { NOW, OTHER_TOKEN, TOKEN, ownerHash } from "../profile-check/test-helpers";
export { makePromo };

/** Строка в памяти: `GenerationRow` плюс то, что пишет POST и читает шаг `write`. */
export type StoredGeneration = GenerationRow &
  Omit<NewGeneration, "tier" | "id"> & { ipHash: string; stepTimings: StepTimings };

/** Репозиторий в памяти. `artifacts` — slug по `generationId`, как LEFT JOIN в SQL. */
export function makeGenerationRepo(now: Date) {
  const rows = new Map<string, StoredGeneration>();
  const artifacts = new Map<string, string>();
  const repo = {
    insert: vi.fn<GenerationRepository["insert"]>(async (row) => {
      rows.set(row.id, {
        ...row,
        status: "queued",
        errorCode: null,
        artifactSlug: null,
        stepTimings: {},
        updatedAt: now,
      });
    }),
    get: vi.fn<GenerationRepository["get"]>(async (id) => {
      const row = rows.get(id);
      if (!row) return null;
      return {
        id: row.id,
        status: row.status,
        errorCode: row.errorCode,
        igUsername: row.igUsername,
        tier: row.tier,
        ownerTokenHash: row.ownerTokenHash,
        artifactSlug: artifacts.get(id) ?? null,
        updatedAt: row.updatedAt,
      };
    }),
    markFailed: vi.fn<GenerationRepository["markFailed"]>(async (id, errorCode, at) => {
      const row = rows.get(id);
      if (!row || row.status === "ready") return false;
      rows.set(id, { ...row, status: "failed", errorCode, updatedAt: at });
      return true;
    }),
    /** Повторяет `advance` в SQL: условный статус, `startedAt` не перезаписывается. */
    advance: vi.fn<GenerationRepository["advance"]>(async (id, input) => {
      const row = rows.get(id);
      if (!row || !input.from.includes(row.status)) return false;
      const at = input.now.toISOString();
      const timings: StepTimings = { ...row.stepTimings };
      for (const step of input.start ?? []) timings[step] ??= { startedAt: at };
      for (const step of input.finish ?? []) {
        const t = timings[step];
        if (t && !t.finishedAt) timings[step] = { ...t, finishedAt: at };
      }
      rows.set(id, { ...row, status: input.to, stepTimings: timings, updatedAt: input.now });
      return true;
    }),
  } satisfies GenerationRepository;
  return { repo, rows, artifacts };
}

export const URL_BODY: GenerationRequest = {
  profileCheckId: "set-by-test",
  mode: "self",
  kind: "roast_v1",
  tier: 1,
  level: "medium",
};

/** Все зависимости на фейках. Проверка профиля уже лежит в БД и принадлежит `TOKEN`. */
export function makeDeps(
  opts: {
    promos?: Parameters<typeof makeOrdersRepo>[0];
    guardAllowed?: boolean;
    check?: Partial<NewProfileCheck> & { checkedAt?: Date };
  } = {},
  now = new Date("2026-10-03T12:00:00.000Z"),
) {
  const generations = makeGenerationRepo(now);
  const profiles = makeProfileRepo();
  const orders = makeOrdersRepo(opts.promos);
  const { guard, enter, fail } = makeGuard(opts.guardAllowed ?? true);
  const startWorkflow = vi.fn<GenerationsHandlerDeps["startWorkflow"]>(async () => {});
  let n = 0;
  const deps: GenerationsHandlerDeps = {
    repo: generations.repo,
    profiles: profiles.repo,
    orders: orders.repo,
    guard,
    startWorkflow,
    newId: () => `gen-${++n}`,
    now: () => now,
  };

  /** Добавить проверку профиля владельцу (по умолчанию `ok`, свежая). */
  const addCheck = async (
    token: string,
    over: Partial<{ checkedAt: Date; igUsername: string }> = {},
  ) =>
    profiles.repo.insert({
      igUsername: over.igUsername ?? "anya.travels",
      ownerTokenHash: ownerHash(token),
      ipHash: "ip",
      status: "ok",
      snapshotId: "snap-1",
      profile: EXPECTED_PROFILE,
      checkedAt: over.checkedAt ?? now,
    });

  return { deps, generations, profiles, orders, enter, fail, startWorkflow, addCheck };
}

export function post(body: unknown, init: { token?: string; ip?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.token) headers.set("cookie", `ownerToken=${init.token}`);
  if (init.ip) headers.set("x-real-ip", init.ip);
  return new NextRequest("http://localhost/api/generations", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function get(id: string, token?: string) {
  return new NextRequest(`http://localhost/api/generations/${id}`, {
    headers: token ? { cookie: `ownerToken=${token}` } : {},
  });
}
