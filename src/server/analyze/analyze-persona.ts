import type { ErrorCode, PersonaProfile as PersonaProfileType, ProfileSnapshot } from "@/contracts";
import { PersonaProfile } from "@/contracts";
import { buildProfileFacts, type ProfileFacts } from "../facts";
import { capCodepoints, cleanUntrusted } from "../facts/text";
import { buildAnalyzePrompt, PROMPT_VERSION } from "../prompts/analyze/v1";
import { MIN_POSTS } from "../scrape";
import { createCoverFetcher, type DownloadedCover, type FetchCoversFn } from "./cover-fetch";
import { pickCovers } from "./covers";
import type { CostMeter } from "../cost/meter";
import { ANALYZE_MODEL, createAnthropicGenerate, LlmSchemaError, type GenerateFn } from "./llm";
import { buildPersona } from "./postprocess";
import { createPersonaRepository, type PersonaRepository } from "./repository";
import { LlmDossier } from "./schema";

/** Первая попытка и до двух ретраев (pipeline.md, правило 2). */
export const MAX_ATTEMPTS = 3;

export type AnalyzeErrorCode = Extract<
  ErrorCode,
  "profile_private" | "minor_detected" | "not_enough_data" | "internal"
>;

/** Наружу — только это. Детали провайдера и текст профиля остаются вне результата и логов. */
export type AnalyzeResult =
  | { ok: true; persona: PersonaProfileType; promptVersion: string; model: string }
  | { ok: false; errorCode: AnalyzeErrorCode };

export type AnalyzeDeps = {
  generate: GenerateFn;
  /** Скачивание обложек (байты для модели). В тестах подменяется: сеть не нужна. */
  fetchCovers: FetchCoversFn;
  /** Подпись модели для `personas.model`. */
  model: string;
};

export type AnalyzeStepDeps = AnalyzeDeps & { personas: PersonaRepository };

/** Реальные реализации создаются лениво: сборка и тесты не требуют ключа и БД. */
export function defaultAnalyzeDeps(meter?: CostMeter): AnalyzeDeps {
  return {
    generate: createAnthropicGenerate(meter),
    fetchCovers: createCoverFetcher(),
    model: ANALYZE_MODEL,
  };
}

/** В лог — только тип события и имя ошибки: ни текста профиля, ни ответа модели, ни ключа. */
function logFailure(event: string, detail?: unknown) {
  const name = detail instanceof Error ? detail.name : "";
  console.error(`[analyze] ${event}${name ? `: ${name}` : ""}`);
}

function formatIssues(error: { issues: readonly { path: PropertyKey[]; message: string }[] }) {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.map(String).join(".") || "(корень)"}: ${i.message}`)
    .join("; ")
    .slice(0, 600);
}

function guardrail(snapshot: ProfileSnapshot, bioOrCaptions: boolean): AnalyzeErrorCode | null {
  if (snapshot.isPrivate) return "profile_private";
  if (snapshot.posts.length < MIN_POSTS || !bioOrCaptions) return "not_enough_data";
  return null;
}

/**
 * Шаг `analyze`, часть LLM: `ProfileSnapshot` → `ProfileFacts` → промпт v1 → досье.
 * Порядок защиты от трат: закрытый и пустой профиль отсекаются до вызова модели; флаги модели
 * (`likelyMinor`, `insufficientData`) → отказ без записи досье. Любое досье, прошедшее все
 * проверки, проходит строгий `PersonaProfile.parse` (инвариант 9).
 *
 * Ретраи: ответ не прошёл схему или вызов упал → ещё до 2 попыток, в промпт идёт причина.
 * Если упал сам вызов (сеть, недоступная картинка), следующая попытка идёт без картинок.
 * Исчерпаны попытки → `internal`. Запись в БД тут нет: см. `analyzeStep`.
 */
export async function analyzePersona(
  snapshot: ProfileSnapshot,
  deps: AnalyzeDeps = defaultAnalyzeDeps(),
): Promise<AnalyzeResult> {
  let facts: ProfileFacts;
  try {
    facts = buildProfileFacts(snapshot);
  } catch (error) {
    logFailure("не удалось посчитать факты", error);
    return { ok: false, errorCode: "internal" };
  }
  const blocked = guardrail(snapshot, facts.biography !== "" || facts.captionsForLlm.length > 0);
  if (blocked) return { ok: false, errorCode: blocked };

  // Один раз до попыток. Не скачавшиеся обложки пропускаются: `index` у остальных остаётся
  // индексом поста, постобработка сверяет look.referenceIndexes именно с этим списком.
  const picked = pickCovers(snapshot);
  let allCovers: DownloadedCover[] = [];
  if (picked.length > 0) {
    try {
      allCovers = await deps.fetchCovers(picked);
    } catch (error) {
      logFailure("сбой скачивания обложек", error);
    }
    console.error(`[analyze] обложки: скачано ${allCovers.length} из ${picked.length}`);
  }
  const displayName = capCodepoints(cleanUntrusted(snapshot.fullName).text, 100);

  let retryNote: string | undefined;
  let withImages = true;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const covers: DownloadedCover[] = withImages ? allCovers : [];
    const prompt = buildAnalyzePrompt({
      facts,
      displayName,
      postCount: snapshot.posts.length,
      covers,
      retryNote,
    });

    let raw: unknown;
    try {
      raw = await deps.generate(prompt);
    } catch (error) {
      if (error instanceof LlmSchemaError) {
        logFailure(`попытка ${attempt}: ответ не по схеме`, error);
        retryNote = error.message;
      } else {
        logFailure(`попытка ${attempt}: сбой вызова модели`, error);
        retryNote = undefined;
        withImages = false;
      }
      continue;
    }

    const soft = LlmDossier.safeParse(raw);
    if (!soft.success) {
      logFailure(`попытка ${attempt}: ответ не прошёл мягкую схему`);
      retryNote = `ответ не по схеме: ${formatIssues(soft.error)}`;
      continue;
    }

    // Гардрейлы раньше всего остального: дальше не платим и ничего не пишем.
    if (soft.data.flags.likelyMinor) return { ok: false, errorCode: "minor_detected" };
    if (soft.data.flags.insufficientData) return { ok: false, errorCode: "not_enough_data" };

    const { result, stats } = buildPersona(soft.data, { snapshot, facts, covers });
    const dropped = Object.entries(stats)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
    if (dropped) console.error(`[analyze] вычеркнуто: ${dropped}`);

    if (!result.success) {
      logFailure(`попытка ${attempt}: досье не прошло контракт`);
      retryNote = `досье не прошло проверку: ${formatIssues(result.error)}`;
      continue;
    }

    return { ok: true, persona: result.data, promptVersion: PROMPT_VERSION, model: deps.model };
  }

  return { ok: false, errorCode: "internal" };
}

export type AnalyzeStepResult =
  | { ok: true; persona: PersonaProfileType; promptVersion: string; model: string; cached: boolean }
  | { ok: false; errorCode: AnalyzeErrorCode };

/**
 * Шаг `analyze` целиком: кэш досье по (snapshotId, promptVersion) → `analyzePersona` → запись.
 * Идемпотентен (инвариант 8): повтор для того же снимка берёт сохранённое досье и не зовёт
 * модель; запись — upsert по тому же ключу. Досье, не прошедшее `.parse()` при чтении, считается
 * промахом и перезаписывается. Отказы гардрейлов не пишутся.
 */
export async function analyzeStep(
  input: { snapshotId: string; snapshot: ProfileSnapshot },
  deps?: AnalyzeStepDeps,
): Promise<AnalyzeStepResult> {
  const { snapshotId, snapshot } = input;
  const personas = deps?.personas ?? createPersonaRepository();

  try {
    const row = await personas.find(snapshotId, PROMPT_VERSION);
    if (row) {
      const parsed = PersonaProfile.safeParse(row.data);
      if (parsed.success) {
        return {
          ok: true,
          persona: parsed.data,
          promptVersion: row.promptVersion,
          model: row.model,
          cached: true,
        };
      }
      logFailure("кэш: досье не прошло схему, пересчитываем");
    }

    const result = await analyzePersona(snapshot, deps);
    if (!result.ok) return result;

    await personas.save({
      snapshotId,
      data: result.persona,
      model: result.model,
      promptVersion: result.promptVersion,
    });
    return { ...result, cached: false };
  } catch (error) {
    logFailure("сбой хранилища", error);
    return { ok: false, errorCode: "internal" };
  }
}
