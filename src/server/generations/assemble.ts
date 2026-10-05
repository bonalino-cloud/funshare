import { randomInt } from "node:crypto";
import {
  Artifact,
  CheckedProfile,
  Tier,
  type GenerationMode,
  type RoastContent,
} from "@/contracts";
import { TIERS } from "../pricing/config";
import type { ArtifactRepository } from "./artifact-repository";
import type { GenerationRepository } from "./repository";

/**
 * Сборка артефакта прожарки (`assemble`, pipeline.md шаг 5). Авторитетно на сервере: из тела
 * запроса выбора берутся только id (они ушли в `punch_candidates.selected`), тексты и эмодзи шуток —
 * из БД, `subject.avatarUrl` — из проверки профиля (наш Blob), а не из снимка Instagram
 * (`architecture/data.md`). Артефакт проходит схему `Artifact` до записи (инварианты 9, 20).
 */

export type AssembleDeps = {
  repo: Pick<GenerationRepository, "get">;
  artifacts: ArtifactRepository;
  now: () => Date;
  /** Slug из 10 символов; на каждую попытку новый, поэтому редкое совпадение лечится повтором шага. */
  newSlug: () => string;
};

/** Причина провала сборки: наружу (в логи) — только код. */
export type AssembleFailureReason =
  "no_input" | "unsupported_kind" | "bad_selection" | "invalid_artifact";

export class AssembleFailedError extends Error {
  constructor(readonly reason: AssembleFailureReason) {
    super(`assemble failed: ${reason}`);
    this.name = "AssembleFailedError";
  }
}

/** Только https: `javascript:` и `data:` в публичный артефакт не пишем. */
function httpsOrNull(url: string | null): string | null {
  return url !== null && URL.canParse(url) && new URL(url).protocol === "https:" ? url : null;
}

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** 10 символов из 62: ~59 бит случайности. Адрес публичный, но перебором не находится. */
export function newSlug(): string {
  let slug = "";
  for (let i = 0; i < 10; i += 1) slug += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return slug;
}

/** «1 шутка», «3 шутки», «6 шуток», «11 шуток», «21 шутка». */
export function jokesWord(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} шуток`;
  if (mod10 === 1) return `${count} шутка`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} шутки`;
  return `${count} шуток`;
}

/**
 * Заголовок, подзаголовок, финал и текст шеринга пока по шаблону: писатель отдаёт только шутки, а
 * контракт требует эти поля. Тёплый финал и хук от модели — задача дорожки юмора.
 */
export function roastFrame(
  username: string,
  count: number,
  mode: GenerationMode,
): Omit<RoastContent, "punches"> {
  return {
    title: `Прожарка @${username}`,
    tagline:
      mode === "self"
        ? `Выбрано вручную: ${jokesWord(count)} про @${username}`
        : `${jokesWord(count)} про @${username} от друга, который всё заметил`,
    finale: "Всё это любя. Если задело, значит, попали в точку.",
    shareText: `Прожарка @${username} на Funshare: ${jokesWord(count)}. Попробуй сам`,
  };
}

/**
 * `awaiting_selection | drawing → ready`. `ready` — артефакт записан (этим вызовом или ранее);
 * `closed` — генерацию уже закрыли (`failed`) или её нет: артефакт не создаётся.
 *
 * Идемпотентно: артефакт и `ready` пишет одна SQL-команда, повтор после `ready` ничего не меняет.
 */
export async function runAssemble(
  deps: AssembleDeps,
  generationId: string,
): Promise<"ready" | "closed"> {
  const input = await deps.artifacts.loadInput(generationId);
  if (!input) return "closed";
  if (input.status === "ready") return "ready";
  if (input.status !== "awaiting_selection" && input.status !== "drawing") return "closed";
  const tier = Tier.safeParse(input.tier);
  if (!tier.success) throw new AssembleFailedError("no_input");
  if (input.kind !== "roast_v1") throw new AssembleFailedError("unsupported_kind");

  const { selected } = input;
  if (selected.length < 1 || selected.length > TIERS[tier.data].selectCount) {
    throw new AssembleFailedError("bad_selection");
  }

  // Проверка профиля: ник и имя как их видел человек, аватар — наша копия в Blob.
  const profile = CheckedProfile.safeParse(input.profile);
  const username = profile.success ? profile.data.username : input.igUsername;
  const now = deps.now();
  const slug = deps.newSlug();

  const candidate = {
    slug,
    kind: "roast_v1" as const,
    createdAt: now.toISOString(),
    subject: {
      username,
      displayName: profile.success ? profile.data.displayName : username,
      avatarUrl: profile.success ? httpsOrNull(profile.data.avatarUrl) : null,
    },
    mode: input.mode,
    content: {
      ...roastFrame(username, selected.length, input.mode),
      punches: selected.map((p) => ({ id: p.punchId, emoji: p.emoji, text: p.text })),
    },
    // Картинки Кострища рисует шаг `draw` (be/p2-draw); пока их нет, как и у Поджога.
    punchImages: [],
    images: [],
    isOwner: false,
  };
  const artifact = Artifact.safeParse(candidate);
  if (!artifact.success || artifact.data.kind !== "roast_v1") {
    throw new AssembleFailedError("invalid_artifact");
  }

  const published = await deps.artifacts.publish({
    generationId,
    slug,
    kind: artifact.data.kind,
    content: artifact.data.content,
    images: [],
    subject: artifact.data.subject,
    ownerTokenHash: input.ownerTokenHash,
    now,
  });
  if (published) return "ready";
  // Не записали: либо уже `ready` (повтор), либо генерацию закрыли между чтением и записью.
  return (await deps.repo.get(generationId))?.status === "ready" ? "ready" : "closed";
}
