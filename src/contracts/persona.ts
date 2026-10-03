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

/**
 * Опора наблюдения: пост (`post:3`) или факт из ProfileFacts (`fact:hashtag:sunset=47`,
 * `fact:location:Санкт-Петербург=3`). Вид факта — одно слово латиницей, после `:` значение
 * (в локациях бывают пробелы). Evidence наполняет LLM из чужого контента и потом читает `write`,
 * поэтому без управляющих и невидимых символов и без `<>` (граница `<profile_data>`, как в ProfileFacts).
 */
export const ObservationEvidence = z
  .string()
  .max(100)
  // Регулярка без флага `u`: схема уходит в JSON Schema для generateObject, `\p{…}` туда не везде
  // проходит. Невидимые символы ловит refine, он проверяется на parse после ответа модели.
  .regex(/^(?:post:\d{1,4}|fact:[a-z][A-Za-z]{0,30}(?::[^<>\r\n]+)?)$/)
  // ZWJ (U+200D) разрешён, как в ProfileFacts: склейка эмодзи в хэштегах и локациях.
  .refine(
    (s) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(s.replace(/‍/g, "")),
    "без управляющих и невидимых символов",
  );

/** Строка досье от LLM: пробелы по краям срезаются, пустая после этого не проходит. */
const DossierText = z.string().trim().min(1).max(200);

/**
 * Наблюдение досье прожарки (roast-engine §4). Из них `write` выбирает крючки для шуток (§5.2).
 */
export const Observation = z.object({
  /** Ключ, на который ссылаются крючки `write`. */
  id: z.string().min(1).max(40),
  /** Что замечено, про поведение или контент, а не про человека: «40 сторис из аэропорта и ноль из дома». */
  claim: DossierText,
  /** Опора на посты и цифры. Пустой список не пропускаем: наблюдение без опоры удаляется (правило досье №1). */
  evidence: z.array(ObservationEvidence).min(1).max(10),
  /** Насколько человек сам себя узнает, 1..5. Крючки сортируются по нему. */
  recognizability: z.number().int().min(1).max(5),
  /** `true` — поведение или контент, не человек; в крючки идут только такие. */
  safe: z.boolean(),
});
export type Observation = z.infer<typeof Observation>;

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
  /**
   * Внешность для карикатуры на картинках (roast-engine §7.0). null — нет ни одного фото,
   * где человек виден крупно и один: картинки рисуются без героя.
   */
  look: z
    .object({
      /** Приметы словами: лицо, причёска и цвет волос, борода, очки, татуировки, одежда. */
      description: z.string().min(1).max(600),
      /** Аватар и 2–3 фото из постов, где он один. Только вход модели, наружу не уходит. */
      referenceImageUrls: z.array(z.url()).min(1).max(4),
    })
    .nullable(),
  /**
   * Досье прожарки (roast-engine §4), потребляет `write`. Все поля необязательны: контракт
   * внутри фазы только расширяется (инвариант 14), старые досье остаются валидными.
   *
   * Наблюдения: до 14 штук, нижней границы нет намеренно. Наблюдения без evidence analyze
   * вычёркивает до записи; если выжило меньше целевых 8, досье всё равно сохраняется, а
   * решение «хватает ли крючков» принимает `write` (внизу воронки лучше `internal`, чем падение analyze).
   * Уникальность `id` обязательна: на него ссылаются крючки.
   *
   * Чего схема не проверяет (делает analyze до записи): `post:N` указывает на существующий пост
   * снапшота; refine уникальности не попадает в JSON Schema для модели, поэтому `id` лучше
   * проставлять кодом, а не просить у LLM.
   */
  observations: z
    .array(Observation)
    .max(14)
    .refine((o) => new Set(o.map((x) => x.id)).size === o.length, { message: "duplicate id" })
    .optional(),
  /** 3–5 настоящих комплиментов из профиля, для тёплого финала. До 5 без нижней границы: см. выше. */
  warmFacts: z.array(DossierText).max(5).optional(),
  /** Повторяющиеся приёмы автора: «закат в каждой подписи». */
  signatureMoves: z.array(DossierText).max(10).optional(),
  /**
   * Потеря, болезнь, развод, переезд из-за войны. Шутки сюда нельзя (правило досье №4).
   * В `avoidTopics` (max 10) физически НЕ дописываются: сумма может превысить лимит, а обрезать
   * чувствительную тему нельзя. Запретный список для `write` и фильтров = `avoidTopics ∪ sensitiveEvents`.
   */
  sensitiveEvents: z.array(DossierText).max(10).optional(),
  flags: PersonaFlags,
});
export type PersonaProfile = z.infer<typeof PersonaProfile>;
