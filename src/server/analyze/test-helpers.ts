import { vi } from "vitest";
import type { ProfileSnapshot } from "@/contracts";
import { at, makePost, makeSnapshot } from "../facts/fixtures";
import type { AnalyzeDeps, AnalyzeStepDeps, FetchAvatarFn } from "./analyze-persona";
import type { FetchCoversFn } from "./cover-fetch";
import type { GenerateFn } from "./llm";
import type { PersonaRepository, PersonaRow } from "./repository";
import type { LlmDossier } from "./schema";

/** Выдуманный профиль: 8 постов, обложки у шести, повторы «закат» и «Сочи». */
export function makeProfile(over: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  const posts = [
    makePost({
      caption: "Закат опять #закат",
      hashtags: ["закат"],
      takenAt: at(1),
      likesCount: 50,
      imageUrl: "https://cdn.example.com/p0.jpg",
      locationName: "Сочи",
    }),
    makePost({
      caption: "Кофе и закат #закат",
      hashtags: ["закат"],
      takenAt: at(2),
      likesCount: 400,
      imageUrl: "https://cdn.example.com/p1.jpg",
      locationName: "Сочи",
    }),
    makePost({
      caption: "Аэропорт снова",
      takenAt: at(3),
      likesCount: 20,
      imageUrl: "https://cdn.example.com/p2.jpg",
    }),
    makePost({
      caption: "Новый город",
      takenAt: at(4),
      likesCount: 300,
      imageUrl: "https://cdn.example.com/p3.jpg",
    }),
    makePost({
      caption: "",
      takenAt: at(5),
      likesCount: 10,
      imageUrl: "https://cdn.example.com/p4.jpg",
    }),
    makePost({
      caption: "Опять кофе",
      takenAt: at(6),
      likesCount: 5,
      imageUrl: "https://cdn.example.com/p5.jpg",
    }),
    makePost({
      caption: "Домой",
      takenAt: at(7),
      likesCount: 15,
      imageUrl: "https://cdn.example.com/p6.jpg",
    }),
    makePost({
      caption: "Закат дома",
      takenAt: at(8),
      likesCount: 25,
      imageUrl: "https://cdn.example.com/p7.jpg",
    }),
  ];
  return makeSnapshot(posts, {
    username: "anya.travels",
    fullName: "Аня Морозова",
    biography: "Путешествую и снимаю закаты",
    avatarUrl: "https://cdn.example.com/avatar.jpg",
    fetchedAt: at(10),
    ...over,
  });
}

export function makeObservation(over: Partial<LlmDossier["observations"][number]> = {}) {
  return {
    claim: "Закат в каждой второй подписи",
    evidence: ["post:0", "fact:hashtag:закат=2"],
    recognizability: 4,
    safe: true,
    ...over,
  };
}

/** Валидный ответ модели: 8 наблюдений с разными claim и опорой (issue #102 — только крючки). */
export function makeDossier(over: Partial<LlmDossier> = {}): LlmDossier {
  return {
    language: "ru",
    humorAngles: ["закаты", "аэропорты"],
    avoidTopics: ["болезни"],
    observations: Array.from({ length: 8 }, (_, i) =>
      makeObservation({ claim: `Наблюдение номер ${i + 1}`, evidence: [`post:${i}`] }),
    ),
    warmFacts: [
      "Находит в каждом городе место, куда хочется вернуться",
      "Умеет смеяться над собой",
      "Верна своим привычкам",
    ],
    sensitiveEvents: [],
    flags: { likelyMinor: false, insufficientData: false },
    ...over,
  };
}

/** Фейки всех внешних зависимостей. Реальных вызовов тесты не делают. */
export function makeDeps(responses: unknown[] | GenerateFn = [makeDossier()]) {
  const queue = Array.isArray(responses) ? [...responses] : [];
  const generate = vi.fn<GenerateFn>(
    typeof responses === "function"
      ? responses
      : async () => {
          const next = queue.length > 1 ? queue.shift() : queue[0];
          if (next instanceof Error) throw next;
          return next;
        },
  );
  // Сеть не трогаем: каждая выбранная обложка «скачивается» в байты-заглушку.
  const fetchCovers = vi.fn<FetchCoversFn>(async (covers) =>
    covers.map((c) => ({
      ...c,
      data: new Uint8Array([0xff, 0xd8, 0xff]),
      mediaType: "image/jpeg" as const,
    })),
  );
  // По умолчанию аватар «не скачался»: большинство тестов обложек это не касается.
  const fetchAvatar = vi.fn<FetchAvatarFn>(async () => null);
  const deps: AnalyzeDeps = { generate, fetchCovers, fetchAvatar, model: "test-model" };
  return { deps, generate, fetchCovers, fetchAvatar };
}

/** In-memory репозиторий с семантикой upsert по (snapshotId, promptVersion). */
export function makeRepo(initial: Record<string, PersonaRow> = {}) {
  const rows = new Map<string, PersonaRow>(Object.entries(initial));
  const key = (id: string, v: string) => `${id}|${v}`;
  const personas: PersonaRepository = {
    find: vi.fn(async (id, v) => rows.get(key(id, v)) ?? null),
    save: vi.fn(async ({ snapshotId, data, model, promptVersion }) => {
      rows.set(key(snapshotId, promptVersion), { data, model, promptVersion });
    }),
  };
  return { personas, rows };
}

export function makeStepDeps(
  responses?: unknown[] | GenerateFn,
  initial?: Record<string, PersonaRow>,
) {
  const { deps, generate, fetchCovers, fetchAvatar } = makeDeps(responses);
  const repo = makeRepo(initial);
  const stepDeps: AnalyzeStepDeps = { ...deps, personas: repo.personas };
  return { deps: stepDeps, generate, fetchCovers, fetchAvatar, ...repo };
}

/** Все текстовые части вызова `generate` одной строкой. */
export function textOf(call: Parameters<GenerateFn>[0]): string {
  return call.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
}
