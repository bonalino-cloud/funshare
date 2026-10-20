import { buildProfilePrompt } from "../prompts/comedy/profile-v1";
import { WriteFailedError } from "../roast/write/types";
import { MIN_PROFILE_FACTS, PROFILE_LIMITS } from "./config";
import { issuePaths, withRetries, type Parsed } from "./retry";
import {
  AudienceItem,
  CAPS,
  FactItem,
  ProfileCore,
  ProfileText,
  QuoteItem,
  type ComedyProfile,
} from "./schema";
import type { ComedyGenerateFn, ComedyMaterial } from "./types";

// Шаг 1 (comedy-engine §7.1): материал → Comedy Profile. Один вызов с картинками. Каждый факт,
// цитата и реакция проверяются отдельно: кривые выбрасываются. Id `F1…`, `Q1…` ставит код.
// `minorSignals = true` — вторая линия защиты 16+: шаг падает `bad_input` без ретраев.

/** Элементы списка, прошедшие схему, не больше `max`. */
function acceptItems<T>(
  raw: readonly unknown[],
  parse: (x: unknown) => T | null,
  max: number,
): T[] {
  const out: T[] = [];
  for (const item of raw) {
    if (out.length >= max) break;
    const value = parse(item);
    if (value !== null) out.push(value);
  }
  return out;
}

const shortText = (cap: number) => (x: unknown) => {
  const r = ProfileText(cap).safeParse(x);
  return r.success ? r.data : null;
};

/** Разбор ответа модели в профиль с id. Бросает `bad_input` при сигналах несовершеннолетнего. */
export function parseProfile(raw: unknown): Parsed<ComedyProfile> {
  // Сигнал несовершеннолетнего действует, даже если остальной ответ кривой: ретраить нельзя.
  if (
    raw !== null &&
    typeof raw === "object" &&
    "minorSignals" in raw &&
    raw.minorSignals === true
  ) {
    throw new WriteFailedError("bad_input");
  }
  const core = ProfileCore.safeParse(raw);
  if (!core.success) {
    return { ok: false, note: `ответ не по схеме профиля (поля: ${issuePaths(core.error)})` };
  }
  const c = core.data;
  if (c.minorSignals) throw new WriteFailedError("bad_input");

  const facts = acceptItems(
    c.facts,
    (x) => {
      const r = FactItem.safeParse(x);
      return r.success ? r.data : null;
    },
    PROFILE_LIMITS.facts,
  ).map((f, i) => ({ id: `F${i + 1}`, ...f }));
  if (facts.length < MIN_PROFILE_FACTS) {
    return {
      ok: false,
      note: `проверяемых фактов ${facts.length}, нужно не меньше ${MIN_PROFILE_FACTS} (лучше 25–45): section, text, source, basis по схеме`,
    };
  }
  const quotes = acceptItems(
    c.quotes,
    (x) => {
      const r = QuoteItem.safeParse(x);
      return r.success ? r.data : null;
    },
    PROFILE_LIMITS.quotes,
  ).map((q, i) => ({ id: `Q${i + 1}`, ...q }));
  const audience = acceptItems(
    c.audience,
    (x) => {
      const r = AudienceItem.safeParse(x);
      return r.success ? r.data : null;
    },
    PROFILE_LIMITS.audience,
  );

  return {
    ok: true,
    value: {
      person: c.person,
      facts,
      quotes,
      audience,
      unknowns: acceptItems(c.unknowns, shortText(CAPS.unknown), PROFILE_LIMITS.unknowns),
      coverage: c.coverage,
      keyObservation: c.keyObservation,
      ownHumor: c.ownHumor,
      closedTopics: acceptItems(
        c.closedTopics,
        shortText(CAPS.closedTopic),
        PROFILE_LIMITS.closedTopics,
      ),
      minorSignals: c.minorSignals,
    },
  };
}

/**
 * Профиль с ретраями. Сбой самого вызова (сеть, недоступная картинка, слишком большой запрос)
 * — следующая попытка без картинок, как в `analyze`.
 */
export async function buildComedyProfile(
  material: ComedyMaterial,
  generate: ComedyGenerateFn,
): Promise<ComedyProfile> {
  let withImages = true;
  return withRetries(
    "профиль",
    ({ retryNote, callFailed }) => {
      if (callFailed) withImages = false;
      return buildProfilePrompt({ material, withImages, retryNote });
    },
    generate,
    parseProfile,
  );
}

/** Все id фактов и цитат профиля: на них ссылаются инсайты. */
export function profileFactIds(profile: ComedyProfile): Set<string> {
  return new Set([...profile.facts.map((f) => f.id), ...profile.quotes.map((q) => q.id)]);
}

/** Источник первого факта или цитаты: `evidenceRef` в трассе кандидата. */
export function factSource(profile: ComedyProfile, id: string | undefined): string {
  if (!id) return "";
  const fact = profile.facts.find((f) => f.id === id) ?? profile.quotes.find((q) => q.id === id);
  return fact?.source ?? "";
}
