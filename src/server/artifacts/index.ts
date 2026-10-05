import { readArtifact, type ArtifactReadDeps, type ArtifactResult } from "./read";
import { createArtifactReadRepository } from "./repository";

export { getArtifactResponse, isArtifactSlug, type ArtifactResult } from "./read";

/** Боевые зависимости. Лениво на каждый вызов: сборка и тесты не требуют БД. */
export function defaultArtifactReadDeps(): ArtifactReadDeps {
  return { repo: createArtifactReadRepository() };
}

/**
 * Для серверной страницы `/a/[slug]`. `ownerToken` — значение cookie `ownerToken` (нужно только для
 * `isOwner`; без него артефакт отдаётся как гостю).
 */
export function getArtifact(slug: string, ownerToken?: string | null): Promise<ArtifactResult> {
  return readArtifact(defaultArtifactReadDeps(), slug, ownerToken);
}
