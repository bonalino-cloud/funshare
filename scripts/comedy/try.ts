import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { desc, eq } from "drizzle-orm";
import { GenerationMode, PersonaProfile, ProfileSnapshot, type Tier } from "../../src/contracts";
import { forbiddenTopics } from "../../src/server/analyze/forbidden";
import { resizeCover } from "../../src/server/analyze/cover-fetch";
import {
  ComedyFailedError,
  defaultComedyDeps,
  writeComedyCandidates,
  type ComedyInput,
  type ComedyTrace,
} from "../../src/server/comedy";
import { parseMaterialFile } from "../../src/server/comedy/material-file";
import { microUsdToCents } from "../../src/server/cost";
import { buildProfileFacts } from "../../src/server/facts";
import type { WrittenCandidate } from "../../src/server/roast/write";

// pnpm comedy:try --ig <ник> | --material <file.json> [--tier 1|2] [--mode self|friend]
//                 [--extra "факт"]... [--out <каталог>]
// Comedy-движок well done (comedy-engine §8) на РЕАЛЬНОЙ модели (нужен ANTHROPIC_API_KEY).
// `--ig` берёт последний снимок и досье из БД (нужен DATABASE_URL), обложки качает с CDN.
// `--material` читает материал из JSON (картинки путями рядом с файлом или абсолютными).
// Пишет в каталог профиль, инсайты, отбор, всех кандидатов и итог. В БД ничего не пишет.

const { values } = parseArgs({
  options: {
    ig: { type: "string" },
    material: { type: "string" },
    tier: { type: "string", default: "1" },
    mode: { type: "string", default: "self" },
    extra: { type: "string", multiple: true, default: [] },
    out: { type: "string" },
  },
});

const USAGE =
  'использование: --ig <ник> | --material <file.json> [--tier 1|2] [--mode self|friend] [--extra "…"] [--out <каталог>]';

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Ник только из безопасных символов: он становится частью пути. */
const safeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_")
    .slice(0, 40) || "run";

async function sourceFromDb(
  nick: string,
): Promise<Pick<ComedyInput, "source" | "forbidden" | "sensitiveEvents"> | null> {
  if (!process.env.DATABASE_URL) {
    console.error("для --ig нужен DATABASE_URL (vercel env pull .env.local)");
    return null;
  }
  const { db, schema } = await import("../../src/server/db");
  const { profileSnapshots, personas } = schema;
  const [snap] = await db()
    .select({ id: profileSnapshots.id, data: profileSnapshots.data })
    .from(profileSnapshots)
    .where(eq(profileSnapshots.igUsername, nick))
    .orderBy(desc(profileSnapshots.fetchedAt))
    .limit(1);
  if (!snap) {
    console.error("снимок профиля с таким ником не найден");
    return null;
  }
  const [row] = await db()
    .select({ data: personas.data })
    .from(personas)
    .where(eq(personas.snapshotId, snap.id))
    .orderBy(desc(personas.createdAt))
    .limit(1);
  const persona = row ? PersonaProfile.safeParse(row.data) : null;
  if (persona?.success) {
    const { isPrivate, likelyMinor, insufficientData } = persona.data.flags;
    if (isPrivate || likelyMinor || insufficientData) {
      console.error(
        "досье с флагом гардрейла (закрыт, похож на несовершеннолетнего или мало данных)",
      );
      return null;
    }
  } else {
    console.error("досье нет или не по схеме: список «нельзя» только из профиля comedy");
  }
  const snapshot = ProfileSnapshot.parse(snap.data);
  return {
    source: { kind: "snapshot", snapshot, facts: buildProfileFacts(snapshot) },
    forbidden: persona?.success ? forbiddenTopics(persona.data) : [],
    sensitiveEvents: persona?.success ? (persona.data.sensitiveEvents ?? []) : [],
  };
}

async function sourceFromFile(
  path: string,
  extra: readonly string[],
): Promise<ComedyInput["source"]> {
  const file = resolve(path);
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  const base = dirname(file);
  const material = await parseMaterialFile(
    raw,
    async (p) => {
      try {
        return new Uint8Array(await readFile(isAbsolute(p) ? p : join(base, p)));
      } catch {
        console.error(`картинка не прочитана, пропущена: ${p}`);
        return null;
      }
    },
    { extraFacts: extra, resize: resizeCover },
  );
  return { kind: "material", material };
}

function finalMarkdown(candidates: readonly WrittenCandidate[]): string {
  const lines = candidates.map((c, i) => {
    const t = c.trace;
    const meta = c.fromTrial
      ? "из Поджога"
      : `${t.insightId ?? t.hookId}, ${t.structure ?? t.mechanism}, оценка ${t.totalScore ?? "-"}`;
    return `${i + 1}. ${c.emoji} ${c.text}\n   _${meta}_`;
  });
  return `# Итог comedy (${candidates.length})\n\n${lines.join("\n\n")}\n`;
}

async function writeRun(out: string, trace: ComedyTrace | null, candidates: WrittenCandidate[]) {
  await mkdir(out, { recursive: true });
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  await writeFile(join(out, "profile.json"), json(trace?.profile ?? null));
  await writeFile(join(out, "insights.json"), json(trace?.insights ?? []));
  await writeFile(join(out, "selection.json"), json(trace?.selection ?? null));
  await writeFile(
    join(out, "candidates.json"),
    json({ rounds: trace?.rounds ?? [], candidates: trace?.candidates ?? [], stats: trace?.stats }),
  );
  await writeFile(join(out, "final.md"), finalMarkdown(candidates));
  await writeFile(join(out, "trace.json"), json(trace));
}

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("нужен ANTHROPIC_API_KEY (vercel env pull .env.local)");
    return 1;
  }
  const nick = values.ig?.replace(/^@/, "").toLowerCase();
  const mode = GenerationMode.safeParse(values.mode);
  const tier = Number(values.tier);
  if (
    (!nick && !values.material) ||
    (nick && values.material) ||
    !mode.success ||
    ![1, 2].includes(tier)
  ) {
    console.error(USAGE);
    return 1;
  }
  const extra = values.extra ?? [];

  let base: Pick<ComedyInput, "source" | "forbidden" | "sensitiveEvents"> | null;
  if (nick) {
    base = await sourceFromDb(nick);
  } else {
    base = {
      source: await sourceFromFile(values.material!, extra),
      forbidden: [],
      sensitiveEvents: [],
    };
  }
  if (!base) return 1;
  const name =
    base.source.kind === "snapshot" ? base.source.snapshot.username : base.source.material.username;
  const out = resolve(values.out ?? join(".comedy-runs", `${safeName(name)}-${stamp(new Date())}`));

  const deps = defaultComedyDeps();
  const input: ComedyInput = {
    ...base,
    extraFacts: base.source.kind === "snapshot" ? extra : [],
    mode: mode.data,
    level: "well_done",
    tier: tier as Tier,
  };

  let code = 0;
  let trace: ComedyTrace | null = null;
  try {
    const result = await writeComedyCandidates(input, deps);
    trace = result.trace;
    await writeRun(out, trace, result.candidates);
    for (const [i, c] of result.candidates.entries()) console.log(`${i + 1}. ${c.emoji} ${c.text}`);
    console.log(`\nшуток: ${result.candidates.length}, раундов: ${result.stats.rounds}`);
  } catch (error) {
    if (!(error instanceof ComedyFailedError)) throw error;
    trace = error.comedyTrace;
    await writeRun(out, trace, []);
    console.error(`провал: ${error.reason}`);
    code = 1;
  }

  if (trace) {
    const t = trace.timingsMs;
    const steps = Object.entries(t)
      .filter(([k]) => k !== "total")
      .map(([k, ms]) => `${k} ${(ms / 1000).toFixed(1)} с`)
      .join(", ");
    console.log(`время: ${((t.total ?? 0) / 1000).toFixed(1)} с (${steps})`);
  }

  const run = deps.meter?.snapshot();
  if (run) {
    const roles = run.llm.map((l) => `${l.role}(${l.model}):${l.calls}/${l.failedCalls}`).join(" ");
    console.log(
      `стоимость: $${(run.microUsd / 1_000_000).toFixed(4)} (${microUsdToCents(run.microUsd)} ¢${run.estimated ? ", оценка" : ""}); вызовы/неудачные: ${roles}`,
    );
  }
  console.log(`результаты: ${out}`);
  return code;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      `comedy:try упал: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown"}`,
    );
    process.exit(1);
  },
);
