import { and, eq, lt } from "drizzle-orm";
import type { AnalyzeErrorCode } from "../analyze";
import { db, schema } from "../db";

/** Отказ гардрейла по досье: хранится, чтобы повтор не звал модель второй раз. */
export type DossierRefusal = Exclude<AnalyzeErrorCode, "internal">;

export type DossierClaim =
  /** Замок взят этим вызовом: досье считать ему. */
  | { kind: "claimed" }
  /** Замок держит другой вызов (фон или старт генерации) и ещё не устарел. */
  | { kind: "running" }
  | { kind: "refused"; errorCode: AnalyzeErrorCode };

export type DossierRunRepository = {
  /**
   * Атомарно: нет строки → вставить `running`; строка `running` старше `staleBefore` → перехватить;
   * `running` свежая → `running`; `refused` → отказ. Один SQL-оператор, гонки между двумя вызовами нет.
   */
  claim(
    snapshotId: string,
    promptVersion: string,
    now: Date,
    staleBefore: Date,
  ): Promise<DossierClaim>;
  /** Записать отказ гардрейла (вместо замка). */
  refuse(snapshotId: string, promptVersion: string, errorCode: DossierRefusal): Promise<void>;
  /** Снять замок (досье готово или расчёт упал): отказ не трогает. */
  release(snapshotId: string, promptVersion: string): Promise<void>;
};

const REFUSALS: ReadonlySet<string> = new Set<DossierRefusal>([
  "profile_private",
  "minor_detected",
  "not_enough_data",
]);

export function createDossierRunRepository(): DossierRunRepository {
  const { dossierRuns } = schema;
  const key = (snapshotId: string, promptVersion: string) =>
    and(eq(dossierRuns.snapshotId, snapshotId), eq(dossierRuns.promptVersion, promptVersion));

  return {
    async claim(snapshotId, promptVersion, now, staleBefore) {
      // Два захода: между INSERT и SELECT строку могли снять (release) — тогда берём замок заново.
      for (let attempt = 0; attempt < 2; attempt++) {
        const inserted = await db()
          .insert(dossierRuns)
          .values({ snapshotId, promptVersion, status: "running", startedAt: now })
          .onConflictDoUpdate({
            target: [dossierRuns.snapshotId, dossierRuns.promptVersion],
            set: { status: "running", errorCode: null, startedAt: now },
            // Перехват только брошенного замка; свежий замок и отказ остаются как есть.
            setWhere: and(
              eq(dossierRuns.status, "running"),
              lt(dossierRuns.startedAt, staleBefore),
            ),
          })
          .returning({ snapshotId: dossierRuns.snapshotId });
        if (inserted.length > 0) return { kind: "claimed" };

        const [row] = await db()
          .select({ status: dossierRuns.status, errorCode: dossierRuns.errorCode })
          .from(dossierRuns)
          .where(key(snapshotId, promptVersion))
          .limit(1);
        if (!row) continue;
        if (row.status === "running") return { kind: "running" };
        const code = row.errorCode;
        return {
          kind: "refused",
          errorCode: code !== null && REFUSALS.has(code) ? (code as DossierRefusal) : "internal",
        };
      }
      return { kind: "running" };
    },

    async refuse(snapshotId, promptVersion, errorCode) {
      await db()
        .update(dossierRuns)
        .set({ status: "refused", errorCode })
        .where(key(snapshotId, promptVersion));
    },

    async release(snapshotId, promptVersion) {
      await db()
        .delete(dossierRuns)
        .where(and(key(snapshotId, promptVersion), eq(dossierRuns.status, "running")));
    },
  };
}
