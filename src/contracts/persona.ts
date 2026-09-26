import { z } from "zod";

// Только BE. Выход шага `analyze` — источник истины для всех типов артефактов.

export const PersonaFlags = z.object({
  /** Профиль закрыт → errorCode `profile_private`. */
  isPrivate: z.boolean(),
  /** Похоже на несовершеннолетнего → errorCode `minor_detected`. */
  likelyMinor: z.boolean(),
  /** Мало постов или пустое описание → errorCode `not_enough_data`. */
  insufficientData: z.boolean(),
});
export type PersonaFlags = z.infer<typeof PersonaFlags>;

export const PersonaProfile = z.object({
  username: z.string().min(1),
  displayName: z.string().min(1),
  /** Язык, на котором писать артефакт (ISO 639-1). */
  language: z.string().length(2),
  summary: z.string().min(1),
  vibe: z.string().min(1),
  traits: z.array(z.string().min(1)).min(3).max(10),
  interests: z.array(z.string().min(1)).max(10),
  habits: z.array(z.string().min(1)).max(10),
  aesthetics: z.string(),
  /** Безопасные темы для дружеских шуток. */
  humorAngles: z.array(z.string().min(1)).max(10),
  /** Чего касаться нельзя в этом профиле, сверх общих красных линий. */
  avoidTopics: z.array(z.string().min(1)).max(10),
  flags: PersonaFlags,
});
export type PersonaProfile = z.infer<typeof PersonaProfile>;
