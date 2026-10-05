import { PUNCH_MAX_CHARS } from "@/contracts";
import { capCodepoints, codepointLength, sanitizeText } from "../../facts/text";
import { MIN_CYRILLIC_SHARE } from "./config";
import { WriterCandidate } from "./schema";
import type { Hook, HookStyle, JudgeScores } from "./types";

// Проверка одного кандидата писателя кодом, до судьи и до БД. Что не по контракту
// (`PunchCandidate`: текст до 140 знаков, эмодзи) или не по-русски, вычёркивается.

export type ValidCandidate = {
  hookId: string;
  mechanism: WriterCandidate["mechanism"];
  evidenceRef: string;
  jokeCardId: string | null;
  emoji: string;
  text: string;
};

export type Rejection =
  "bad_shape" | "empty" | "too_long" | "not_russian" | "unknown_hook" | "duplicate";

const FALLBACK_EMOJI = "🔥";
const EMOJI_MAX_CODEPOINTS = 12;

/** Доля кириллицы среди букв: язык прожарки всегда русский (решение 05.10). */
export function cyrillicShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const cyr = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length;
  return cyr / letters.length;
}

export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Эмодзи из ответа модели; всё, что не похоже на эмодзи, заменяется запасным. */
export function cleanEmoji(raw: string): string {
  const e = sanitizeText(raw);
  if (e === "" || codepointLength(e) > EMOJI_MAX_CODEPOINTS) return FALLBACK_EMOJI;
  if (!/\p{Extended_Pictographic}/u.test(e)) return FALLBACK_EMOJI;
  // Буквы и цифры рядом с эмодзи («🔥 огонь») — не эмодзи.
  if (/[\p{L}\p{N}]/u.test(e)) return FALLBACK_EMOJI;
  return e;
}

export function validateCandidate(
  raw: unknown,
  style: HookStyle,
): { ok: true; value: ValidCandidate } | { ok: false; reason: Rejection } {
  const parsed = WriterCandidate.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "bad_shape" };
  const c = parsed.data;

  const text = sanitizeText(c.text);
  if (text === "") return { ok: false, reason: "empty" };
  // Контракт считает единицы UTF-16 (`z.string().max`), это не меньше, чем кодпоинты.
  if (text.length > PUNCH_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (cyrillicShare(text) < MIN_CYRILLIC_SHARE) return { ok: false, reason: "not_russian" };

  const hook: Hook = style.hook;
  const evidenceRef = hook.evidence.includes(c.evidenceRef)
    ? c.evidenceRef
    : (hook.evidence[0] ?? "");
  const skeleton = c.skeleton ? style.skeletons.find((s) => s.ref === c.skeleton) : undefined;

  return {
    ok: true,
    value: {
      hookId: hook.id,
      mechanism: c.mechanism,
      evidenceRef: capCodepoints(evidenceRef, 100),
      jokeCardId: skeleton?.cardId ?? null,
      emoji: cleanEmoji(c.emoji),
      text,
    },
  };
}

export const totalScore = (s: JudgeScores) =>
  s.recognizability + s.surprise + s.brevity + s.aboutBehavior + s.warmth;
