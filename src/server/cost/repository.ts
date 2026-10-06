import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { CostRun } from "./meter";

export type GenerationCostRepository = {
  /** Добавляет прогон шага к стоимости генерации (атомарно, один UPDATE). */
  addStepCost(generationId: string, step: string, run: CostRun): Promise<void>;
};

/**
 * UPDATE стоимости генерации. Складываем и пересчитываем центы В БД, а не читаем-пишем из кода:
 * параллельные шаги и ретраи не теряют друг друга. Центы = ceil(сумма микро-USD / 10000) от
 * ИТОГА, не от строк. `costDetail[step]` — массив прогонов: повтор шага дописывает элемент,
 * потому что ретрай стоит реальных денег. Стоимость проверки профиля сюда не входит.
 */
export function addStepCostSet(step: string, run: CostRun) {
  const micro = run.microUsd;
  const col = schema.generations;
  return {
    costMicroUsd: sql`${col.costMicroUsd} + ${micro}::int`,
    costCents: sql`ceil((${col.costMicroUsd} + ${micro}::int)::numeric / 10000)::int`,
    costDetail: sql`jsonb_set(${col.costDetail}, ${`{${step}}`}::text[], coalesce(${col.costDetail} -> ${step}::text, '[]'::jsonb) || jsonb_build_array(${JSON.stringify(run)}::jsonb), true)`,
  };
}

export function createGenerationCostRepository(): GenerationCostRepository {
  return {
    async addStepCost(generationId, step, run) {
      // Граница: пишем только то, что прошло схему.
      const parsed = CostRun.parse(run);
      await db()
        .update(schema.generations)
        .set(addStepCostSet(step, parsed))
        .where(eq(schema.generations.id, generationId));
    },
  };
}
