import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createJokeRepository } from "../../src/server/roast/jokes/repository";
import { CsvFormatError } from "../../src/server/roast/jokes/csv";
import { planReviewImport } from "../../src/server/roast/jokes/review";

// pnpm jokes:review:import --in <csv> [--dry-run]
// Читает approved и ручные правки mechanism/skeleton/heat/topic. Красные линии из CSV не снимаются.

const { values } = parseArgs({
  options: { in: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});

async function main(): Promise<number> {
  if (!values.in) {
    console.error("укажи файл: pnpm jokes:review:import --in <csv>");
    return 1;
  }
  if (!process.env.DATABASE_URL) {
    console.error("не задана переменная окружения DATABASE_URL (vercel env pull .env.local)");
    return 1;
  }
  const repo = createJokeRepository();
  const plan = planReviewImport(await readFile(values.in, "utf8"), await repo.listForReview());
  if (!values["dry-run"]) await repo.applyReviewUpdates(plan.updates);

  console.log(
    `${values["dry-run"] ? "[dry-run] " : ""}обновлено: ${plan.updates.length}, ` +
      `без изменений: ${plan.unchanged}, отклонено: ${plan.rejected.length}`,
  );
  for (const r of plan.rejected) console.log(`  отклонено ${r.source || "(пусто)"}: ${r.reason}`);
  return plan.rejected.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Сообщение показываем только у своих ошибок формата: в чужих может оказаться текст.
    if (error instanceof CsvFormatError) console.error(`import: ${error.message}`);
    else console.error(`import упал: ${error instanceof Error ? error.name : "unknown"}`);
    process.exit(1);
  },
);
