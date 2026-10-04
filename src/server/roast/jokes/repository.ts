import { randomUUID } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Level } from "@/contracts";
import { db, schema } from "../../db";
import type { JokeLabel } from "./card";
import { exampleWhere, skeletonWhere } from "./conditions";

const { jokeCards } = schema;

export type ExistingCard = { source: string; text: string; textHash: string; approved: boolean };

export type CardWrite = {
  source: string;
  section: number;
  text: string;
  textHash: string;
  /** Уже с выведенными флагами (`deriveFlags`). */
  label: JokeLabel;
  labelVersion: string;
  labelModel: string;
};

export type ReviewCard = JokeLabel & {
  source: string;
  text: string;
  textHash: string;
  approved: boolean;
};

/** Ручные правки из CSV: только `approved` и перечисленные поля разметки (флаги — после `deriveFlags`). */
export type ReviewUpdate = {
  source: string;
  approved?: boolean;
  label?: Pick<JokeLabel, "mechanism" | "skeleton" | "heat" | "topic" | "redline" | "wellDoneOnly">;
};

export type JokeRepository = {
  listExisting(): Promise<ExistingCard[]>;
  /** Upsert по `source`. Конфликт = текст изменился: разметка перезаписана, `approved` сброшен. */
  upsertCards(rows: readonly CardWrite[]): Promise<void>;
  listForReview(): Promise<ReviewCard[]>;
  applyReviewUpdates(updates: readonly ReviewUpdate[]): Promise<void>;
};

const CHUNK = 50;

export function createJokeRepository(): JokeRepository {
  return {
    async listExisting() {
      return db()
        .select({
          source: jokeCards.source,
          text: jokeCards.text,
          textHash: jokeCards.textHash,
          approved: jokeCards.approved,
        })
        .from(jokeCards);
    },

    async upsertCards(rows) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        await db()
          .insert(jokeCards)
          .values(
            chunk.map((r) => ({
              id: randomUUID(),
              source: r.source,
              section: r.section,
              text: r.text,
              textHash: r.textHash,
              ...r.label,
              labelVersion: r.labelVersion,
              labelModel: r.labelModel,
            })),
          )
          .onConflictDoUpdate({
            target: jokeCards.source,
            // id, score и createdAt не трогаем; текст изменился, поэтому одобрение недействительно.
            set: {
              section: sql`excluded.section`,
              text: sql`excluded.text`,
              textHash: sql`excluded.text_hash`,
              mechanism: sql`excluded.mechanism`,
              skeleton: sql`excluded.skeleton`,
              slots: sql`excluded.slots`,
              heat: sql`excluded.heat`,
              topic: sql`excluded.topic`,
              redline: sql`excluded.redline`,
              wellDoneOnly: sql`excluded.well_done_only`,
              nsfw: sql`excluded.nsfw`,
              transferable: sql`excluded.transferable`,
              labelVersion: sql`excluded.label_version`,
              labelModel: sql`excluded.label_model`,
              approved: false,
              updatedAt: new Date(),
            },
          });
      }
    },

    async listForReview() {
      return db()
        .select({
          source: jokeCards.source,
          text: jokeCards.text,
          textHash: jokeCards.textHash,
          approved: jokeCards.approved,
          mechanism: jokeCards.mechanism,
          skeleton: jokeCards.skeleton,
          slots: jokeCards.slots,
          heat: jokeCards.heat,
          topic: jokeCards.topic,
          redline: jokeCards.redline,
          wellDoneOnly: jokeCards.wellDoneOnly,
          nsfw: jokeCards.nsfw,
          transferable: jokeCards.transferable,
        })
        .from(jokeCards)
        .orderBy(asc(jokeCards.section), asc(jokeCards.createdAt));
    },

    async applyReviewUpdates(updates) {
      for (const u of updates) {
        await db()
          .update(jokeCards)
          .set({
            ...(u.approved !== undefined ? { approved: u.approved } : {}),
            ...(u.label ?? {}),
          })
          .where(eq(jokeCards.source, u.source));
      }
    },
  };
}

/** Карточка для рантайма: `text` только у примеров, скелету текст оригинала не нужен. */
export type RuntimeCard = {
  id: string;
  source: string;
  mechanism: JokeLabel["mechanism"];
  skeleton: string;
  slots: JokeLabel["slots"];
  heat: JokeLabel["heat"];
  topic: JokeLabel["topic"];
  score: number;
  text: string | null;
};

/**
 * Чтение банка для рантайма (подбор §5.3 — отдельная задача). Фильтр в SQL построен от тех же
 * правил, что `usableAsExample` / `usableAsSkeleton`. Для `skeleton` уровень не влияет.
 */
export async function listCards(opts: {
  level: Level;
  kind: "example" | "skeleton";
}): Promise<RuntimeCard[]> {
  const isExample = opts.kind === "example";
  const rows = await db()
    .select({
      id: jokeCards.id,
      source: jokeCards.source,
      mechanism: jokeCards.mechanism,
      skeleton: jokeCards.skeleton,
      slots: jokeCards.slots,
      heat: jokeCards.heat,
      topic: jokeCards.topic,
      score: jokeCards.score,
      text: jokeCards.text,
    })
    .from(jokeCards)
    .where(isExample ? exampleWhere(opts.level) : skeletonWhere())
    .orderBy(desc(jokeCards.score), asc(jokeCards.source));
  return rows.map((r) => ({ ...r, text: isExample ? r.text : null }));
}
