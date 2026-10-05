import { eq } from "drizzle-orm";
import type { ArtifactKind, GenerationMode } from "@/contracts";
import { db, schema } from "../db";

/**
 * Строка для публичного чтения. Только то, что нужно, чтобы собрать `Artifact`: `ownerTokenHash`
 * нужен лишь для `isOwner` и наружу не уходит. `content`, `images` и `profile` — jsonb: недоверенные,
 * проходят схему `Artifact` до отправки.
 */
export type ArtifactReadRow = {
  slug: string;
  kind: ArtifactKind;
  content: unknown;
  images: unknown;
  ownerTokenHash: string;
  createdAt: Date;
  deletedAt: Date | null;
  mode: GenerationMode;
  igUsername: string;
  /** Сохранённый при публикации `subject`; `null` у старых строк. */
  subject: unknown;
  /** Запасной путь для `subject = null`: проверка профиля (`CheckedProfile`); `null`, если строку проверки уже удалили. */
  profile: unknown;
};

export type ArtifactReadRepository = {
  /** Удалённые (`deletedAt`) тоже возвращаются: отличить 410 от 404 решает вызывающий. */
  findBySlug(slug: string): Promise<ArtifactReadRow | null>;
};

export function createArtifactReadRepository(): ArtifactReadRepository {
  return {
    async findBySlug(slug) {
      const [row] = await db()
        .select({
          slug: schema.artifacts.slug,
          kind: schema.artifacts.kind,
          content: schema.artifacts.content,
          images: schema.artifacts.images,
          subject: schema.artifacts.subject,
          ownerTokenHash: schema.artifacts.ownerTokenHash,
          createdAt: schema.artifacts.createdAt,
          deletedAt: schema.artifacts.deletedAt,
          mode: schema.generations.mode,
          igUsername: schema.generations.igUsername,
          profile: schema.profileChecks.profile,
        })
        .from(schema.artifacts)
        .innerJoin(schema.generations, eq(schema.generations.id, schema.artifacts.generationId))
        .leftJoin(
          schema.profileChecks,
          eq(schema.profileChecks.id, schema.generations.profileCheckId),
        )
        .where(eq(schema.artifacts.slug, slug))
        .limit(1);
      return row ?? null;
    },
  };
}
