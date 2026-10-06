import { parseArgs } from "node:util";
import { desc, eq } from "drizzle-orm";
import {
  Level,
  GenerationMode,
  PersonaProfile,
  ProfileSnapshot,
  type Tier,
} from "../../src/contracts";
import { db, schema } from "../../src/server/db";
import { buildProfileFacts } from "../../src/server/facts";
import { defaultWriteDeps, writeCandidates } from "../../src/server/roast/write";
import { listTastePacks } from "../../src/server/taste";

// pnpm roast:try --ig <nick> [--level rare|medium|well_done] [--tier 1|2|3] [--mode self|friend] [--extra "факт"] [--taste taste/v1]
// Берёт последний снимок и досье по нику, зовёт РЕАЛЬНУЮ модель (нужен ANTHROPIC_API_KEY),
// печатает кандидатов. Генерацию и кандидатов в БД не пишет.

const { values } = parseArgs({
  options: {
    ig: { type: "string" },
    level: { type: "string", default: "medium" },
    tier: { type: "string", default: "2" },
    mode: { type: "string", default: "self" },
    taste: { type: "string" },
    extra: { type: "string", multiple: true, default: [] },
  },
});

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) {
    console.error("нужны DATABASE_URL и ANTHROPIC_API_KEY (vercel env pull .env.local)");
    return 1;
  }
  const nick = values.ig?.replace(/^@/, "").toLowerCase();
  const level = Level.safeParse(values.level);
  const mode = GenerationMode.safeParse(values.mode);
  const tier = Number(values.tier);
  if (!nick || !level.success || !mode.success || ![1, 2, 3].includes(tier)) {
    console.error(
      "использование: --ig <ник> [--level ...] [--tier 1|2|3] [--mode self|friend] [--taste <пакет>]",
    );
    return 1;
  }
  // Имя пакета проверяем до БД: опечатка в `--taste` не должна стоить запросов.
  if (values.taste !== undefined && !listTastePacks().includes(values.taste)) {
    console.error(`неизвестный пакет вкуса; есть: ${listTastePacks().join(", ")}`);
    return 1;
  }

  const { profileSnapshots, personas } = schema;
  const [snap] = await db()
    .select({ id: profileSnapshots.id, data: profileSnapshots.data })
    .from(profileSnapshots)
    .where(eq(profileSnapshots.igUsername, nick))
    .orderBy(desc(profileSnapshots.fetchedAt))
    .limit(1);
  if (!snap) {
    console.error("снимок профиля с таким ником не найден");
    return 1;
  }
  const [persona] = await db()
    .select({ data: personas.data })
    .from(personas)
    .where(eq(personas.snapshotId, snap.id))
    .orderBy(desc(personas.createdAt))
    .limit(1);
  if (!persona) {
    console.error("для снимка нет досье (сначала шаг analyze)");
    return 1;
  }

  const snapshot = ProfileSnapshot.parse(snap.data);
  const result = await writeCandidates(
    {
      persona: PersonaProfile.parse(persona.data),
      facts: buildProfileFacts(snapshot),
      extraFacts: values.extra ?? [],
      mode: mode.data,
      level: level.data,
      tier: tier as Tier,
      tastePack: values.taste,
    },
    defaultWriteDeps(),
  );

  for (const c of result.candidates) {
    console.log(`${c.emoji} ${c.text}`);
    console.log(
      `   механизм: ${c.trace.mechanism}, оценка: ${c.trace.totalScore}, зацепка: ${c.trace.hookId}`,
    );
  }
  console.log(
    `\nкандидатов: ${result.candidates.length}, пакет: ${result.tastePack}, промпт: ${result.promptVersion}`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`try-write упал: ${error instanceof Error ? error.name : "unknown"}`);
    process.exit(1);
  },
);
