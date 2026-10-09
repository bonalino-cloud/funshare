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
import type { ArtifactRepository } from "./artifact-repository";
import type {
  CandidateRow,
  GenerationRepository,
  GenerationRow,
  NewGeneration,
} from "./repository";

export { NOW, OTHER_TOKEN, TOKEN, ownerHash } from "../profile-check/test-helpers";
export { makePromo };

/** Строка в памяти: `GenerationRow` плюс то, что пишет POST и читает шаг `write`. */
export type StoredGeneration = GenerationRow &
  Omit<NewGeneration, "tier" | "id"> & { ipHash: string; stepTimings: StepTimings };

/** Репозиторий в памяти. `artifacts` — slug по `generationId`, как LEFT JOIN в SQL. */
export function makeGenerationRepo(now: Date) {
  const rows = new Map<string, StoredGeneration>();
  const artifacts = new Map<string, string>();
  /** Кандидаты и выбор: `selectionPosition` как в `punch_candidates` (с 1, у невыбранных `null`). */
  const candidates = new Map<string, (CandidateRow & { selectionPosition: number | null })[]>();
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
    listCandidates: vi.fn<GenerationRepository["listCandidates"]>(async (id) =>
      (candidates.get(id) ?? []).map((c) => ({
        punchId: c.punchId,
        emoji: c.emoji,
        text: c.text,
        fromTrial: c.fromTrial,
      })),
    ),
    listSelection: vi.fn<GenerationRepository["listSelection"]>(async (id) =>
      (candidates.get(id) ?? [])
        .filter((c) => c.selectionPosition !== null)
        .sort((a, b) => (a.selectionPosition ?? 0) - (b.selectionPosition ?? 0))
        .map((c) => c.punchId),
    ),
    /** Повторяет `submitSelectionSql`: «замок» — `finishedAt` у `awaiting_selection`, id все из генерации. */
    submitSelection: vi.fn<GenerationRepository["submitSelection"]>(async (input) => {
      const row = rows.get(input.generationId);
      const list = candidates.get(input.generationId) ?? [];
      if (!row || row.status !== "awaiting_selection") return false;
      if (row.stepTimings.awaiting_selection?.finishedAt) return false;
      if (input.punchIds.length < 1 || input.punchIds.length > input.max) return false;
      if (!input.punchIds.every((p) => list.some((c) => c.punchId === p))) return false;
      const at = input.now.toISOString();
      rows.set(input.generationId, {
        ...row,
        stepTimings: {
          ...row.stepTimings,
          awaiting_selection: {
            startedAt: row.stepTimings.awaiting_selection?.startedAt ?? at,
            finishedAt: at,
          },
        },
        updatedAt: input.now,
      });
      for (const c of list) {
        const index = input.punchIds.indexOf(c.punchId);
        c.selectionPosition = index === -1 ? null : index + 1;
      }
      return true;
    }),
  } satisfies GenerationRepository;

  /** Положить кандидатов: `fromTrial` у кого указано. */
  const addCandidates = (id: string, list: { punchId: string; emoji?: string; text: string }[]) =>
    candidates.set(
      id,
      list.map((c) => ({
        punchId: c.punchId,
        emoji: c.emoji ?? "🔥",
        text: c.text,
        fromTrial: false,
        selectionPosition: null,
      })),
    );
  return { repo, rows, artifacts, candidates, addCandidates };
}

/**
 * Репозиторий артефактов в памяти поверх строк генерации. Повторяет `publishSql`: артефакт и `ready`
 * вместе, только из `awaiting_selection`/`drawing`, второй артефакт на ту же генерацию не создаётся.
 */
export function makeArtifactRepo(
  generations: ReturnType<typeof makeGenerationRepo>,
  profile: unknown = EXPECTED_PROFILE,
) {
  const published: Parameters<ArtifactRepository["publish"]>[0][] = [];
  const repo = {
    loadInput: vi.fn<ArtifactRepository["loadInput"]>(async (id) => {
      const row = generations.rows.get(id);
      if (!row) return null;
      return {
        status: row.status,
        tier: row.tier,
        kind: row.kind,
        mode: row.mode,
        igUsername: row.igUsername,
        ownerTokenHash: row.ownerTokenHash,
        profile,
        selected: (generations.candidates.get(id) ?? [])
          .filter((c) => c.selectionPosition !== null)
          .sort((a, b) => (a.selectionPosition ?? 0) - (b.selectionPosition ?? 0))
          .map((c) => ({ punchId: c.punchId, emoji: c.emoji, text: c.text })),
      };
    }),
    publish: vi.fn<ArtifactRepository["publish"]>(async (input) => {
      const row = generations.rows.get(input.generationId);
      if (!row || !["awaiting_selection", "drawing"].includes(row.status)) return false;
      if (generations.artifacts.has(input.generationId)) return false;
      generations.artifacts.set(input.generationId, input.slug);
      generations.rows.set(input.generationId, {
        ...row,
        status: "ready",
        updatedAt: input.now,
      });
      published.push(input);
      return true;
    }),
  } satisfies ArtifactRepository;
  return { repo, published };
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
  const ensureDossier = vi.fn<GenerationsHandlerDeps["ensureDossier"]>(async () => ({ ok: true }));
  const onMinor = vi.fn<GenerationsHandlerDeps["onMinor"]>(async () => {});
  let n = 0;
  const deps: GenerationsHandlerDeps = {
    repo: generations.repo,
    profiles: profiles.repo,
    orders: orders.repo,
    guard,
    ensureDossier,
    onMinor,
    dossierWaitMs: 1234,
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

  return {
    deps,
    generations,
    profiles,
    orders,
    enter,
    fail,
    startWorkflow,
    ensureDossier,
    onMinor,
    addCheck,
  };
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
