import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { planIngest, runIngest } from "../../src/server/roast/jokes/ingest";
import { createAnthropicLabelGenerate, LABEL_MODEL } from "../../src/server/roast/jokes/llm";
import { createJokeRepository } from "../../src/server/roast/jokes/repository";

// Тонкая обёртка над src/server/roast/jokes/ingest.ts. Печатает счётчики и source-ы, не тексты шуток.
// pnpm jokes:ingest [--source <path>] [--dry-run]

const DEFAULT_SOURCE = "business/roast-jokes-depersonalized.md";

const { values } = parseArgs({
  options: { source: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});
const sourcePath = values.source ?? process.env.JOKES_SOURCE_PATH ?? DEFAULT_SOURCE;
const dryRun = values["dry-run"] === true;

async function main(): Promise<number> {
  const md = await readFile(sourcePath, "utf8");

  if (dryRun) {
    // Без БД и без LLM: сравнить с банком нельзя, поэтому «новые» = всё, что не дубль.
    const plan = planIngest(md, []);
    console.log(`[dry-run] источник: ${sourcePath}`);
    console.log(
      `записей: ${plan.parsed}, к разметке: ${plan.entries.length}, дублей: ${plan.duplicates.length}`,
    );
    for (const d of plan.duplicates) console.log(`  дубль ${d.source} ~ ${d.of}`);
    for (const issue of plan.issues) console.log(`  проблема корпуса: ${issue}`);
    return plan.issues.length > 0 ? 1 : 0;
  }

  const missing = ["DATABASE_URL", "ANTHROPIC_API_KEY"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `не заданы переменные окружения: ${missing.join(", ")} (vercel env pull .env.local)`,
    );
    return 1;
  }

  const repo = createJokeRepository();
  const plan = planIngest(md, await repo.listExisting());
  const report = await runIngest(plan, {
    generate: createAnthropicLabelGenerate(),
    save: (rows) => repo.upsertCards(rows),
    model: LABEL_MODEL,
  });

  console.log(`источник: ${sourcePath}`);
  console.log(
    `записей: ${report.parsed}, без изменений: ${report.unchanged}, новых: ${report.new}, ` +
      `изменённых: ${report.changed}, записано: ${report.written}, дублей: ${report.duplicates.length}, ` +
      `ошибок разметки: ${report.failed.length}, нет в файле: ${report.missingInSource.length}`,
  );
  for (const d of report.duplicates) console.log(`  дубль ${d.source} ~ ${d.of}`);
  for (const f of report.failed) console.log(`  не записано ${f.key}: ${f.reason}`);
  for (const issue of report.issues) console.log(`  проблема корпуса: ${issue}`);
  // Удалённая из md шутка остаётся в банке одобренной: снять approved — через ревью CSV.
  for (const s of report.missingInSource) console.log(`  нет в файле, осталась в банке: ${s}`);
  return report.failed.length > 0 || report.issues.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Только имя ошибки: тело может нести фрагменты текста.
    console.error(`ingest упал: ${error instanceof Error ? error.name : "unknown"}`);
    process.exit(1);
  },
);
