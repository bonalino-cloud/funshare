import {
  CandidatesResponse,
  PersonaProfile,
  ProfileSnapshot,
  PunchCandidate,
  type Tier,
} from "@/contracts";
import { buildProfileFacts } from "../../facts";
import { TIERS } from "../../pricing/config";
import { PunchTraceSchema } from "./schema";
import { createWriteRepository, type WriteRepository } from "./repository";
import { WriteFailedError, type CarriedPunch } from "./types";
import { defaultWriteDeps, writeCandidates, type WriteDeps } from "./write-candidates";

export type WriteStepDeps = { repo: WriteRepository; write: () => WriteDeps };

/** Боевые зависимости. Лениво на каждый вызов шага: сборка и тесты не требуют БД и ключа. */
export function defaultWriteStepDeps(): WriteStepDeps {
  return { repo: createWriteRepository(), write: defaultWriteDeps };
}

function logFailure(event: string) {
  console.error(`[write] ${event}`);
}

/** Перенос выбранных в Поджоге шуток (§7.1a): только валидные, не больше `selectCount`. */
async function loadCarried(
  repo: WriteRepository,
  trialGenerationId: string | null,
  tier: Tier,
): Promise<CarriedPunch[]> {
  if (tier !== 2 || trialGenerationId === null) return [];
  const rows = await repo.listSelected(trialGenerationId);
  const out: CarriedPunch[] = [];
  for (const row of rows) {
    const punch = PunchCandidate.safeParse({ id: row.punchId, emoji: row.emoji, text: row.text });
    const trace = PunchTraceSchema.safeParse(row.trace);
    if (!punch.success || !trace.success) {
      logFailure("перенос: запись Поджога не прошла схему, пропущена");
      continue;
    }
    out.push({
      id: punch.data.id,
      emoji: punch.data.emoji,
      text: punch.data.text,
      trace: trace.data,
    });
    if (out.length >= TIERS[tier].selectCount) break;
  }
  return out;
}

/**
 * Шаг `write` с БД: вход из строк генерации → `writeCandidates` → кандидаты в `punch_candidates`.
 * Идемпотентен (инвариант 8): кандидаты уже есть — модель не зовём. Провал — `WriteFailedError`
 * (workflow превращает его в `failed/internal` без ретраев). Список проходит контракт
 * `CandidatesResponse` до записи (инварианты 9, 20).
 */
export async function runWriteStep(
  generationId: string,
  deps: WriteStepDeps = defaultWriteStepDeps(),
): Promise<void> {
  const { repo } = deps;
  if (await repo.hasCandidates(generationId)) return;

  const row = await repo.loadInput(generationId);
  if (!row) throw new WriteFailedError("no_input");

  const persona = PersonaProfile.safeParse(row.persona);
  const snapshot = ProfileSnapshot.safeParse(row.snapshot);
  if (!persona.success || !snapshot.success) {
    logFailure("досье или снимок не прошли схему");
    throw new WriteFailedError("bad_input");
  }
  // Гардрейлы (инвариант 11): такое досье не должно было дойти до платных шагов.
  const { isPrivate, likelyMinor, insufficientData } = persona.data.flags;
  if (isPrivate || likelyMinor || insufficientData) throw new WriteFailedError("bad_input");

  const facts = buildProfileFacts(snapshot.data);
  const carried = await loadCarried(repo, row.trialGenerationId, row.tier);

  const result = await writeCandidates(
    {
      persona: persona.data,
      facts,
      extraFacts: row.extraFacts,
      mode: row.mode,
      level: row.level,
      tier: row.tier,
      carried,
    },
    deps.write(),
  );

  const response = CandidatesResponse.safeParse({
    generationId,
    selectCount: TIERS[row.tier].selectCount,
    candidates: result.candidates.map((c) => ({
      id: c.id,
      emoji: c.emoji,
      text: c.text,
      ...(c.fromTrial ? { fromTrial: true } : {}),
    })),
  });
  if (!response.success) {
    logFailure("список кандидатов не прошёл контракт");
    throw new WriteFailedError("invalid_output");
  }

  await repo.saveCandidates(generationId, result.candidates, result.promptVersion);
}
