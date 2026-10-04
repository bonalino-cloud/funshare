import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { createJokeRepository } from "../../src/server/roast/jokes/repository";
import { exportReviewCsv } from "../../src/server/roast/jokes/review";

// pnpm jokes:review:export [--out <path>] [--pending]
// CSV содержит тексты 18+: по умолчанию пишется в игнорируемую git папку .jokes-review/.

const { values } = parseArgs({
  options: { out: { type: "string" }, pending: { type: "boolean", default: false } },
});
const out = values.out ?? ".jokes-review/jokes-review.csv";

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error("не задана переменная окружения DATABASE_URL (vercel env pull .env.local)");
    return 1;
  }
  const cards = await createJokeRepository().listForReview();
  const csv = exportReviewCsv(cards, { pendingOnly: values.pending });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, csv, "utf8");
  const shown = values.pending ? cards.filter((c) => !c.approved).length : cards.length;
  console.log(`карточек в банке: ${cards.length}, выгружено: ${shown} -> ${out}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`export упал: ${error instanceof Error ? error.name : "unknown"}`);
    process.exit(1);
  },
);
