import type { GenerationMode, Level, ProfileSnapshot, Tier } from "@/contracts";
import type { FetchCoversFn } from "../analyze/cover-fetch";
import type { CostMeter } from "../cost/meter";
import type { ProfileFacts } from "../facts";
import type { LeakIndex } from "../roast/filters";
import type { CarriedPunch } from "../roast/write/types";
import type { ComedyRole } from "./llm";

// Типы comedy-движка (comedy-engine §2, §8). Чистые типы: без БД, env и LLM.

/** Подпись картинки в материале: аватар или обложка поста с номером во входе. */
export type ImageLabel = "avatar" | `post:${number}`;

export type MaterialImage = { label: ImageLabel; data: Uint8Array; mediaType: string };

export type MaterialPost = {
  /** Номер поста во входе: ссылка `post:N`. */
  index: number;
  takenAt: string | null;
  /** photo | video | carousel (как отдал источник). */
  type: string | null;
  /** После чистки PII, до 300 знаков; пустая, если подписи нет или в ней была PII. */
  caption: string;
  hashtags: string[];
  location: string | null;
  likes: number | null;
  comments: number | null;
};

/**
 * Нейтральный материал о человеке (§2). Движок читает его, а не снимок Apify напрямую. Всё
 * внутри — НЕдоверенные данные: в промпт только внутри `<profile_data>` после `defang`.
 */
export type ComedyMaterial = {
  source: "apify" | "agent-reach";
  username: string;
  displayName: string;
  biography: string;
  counters: { posts: number | null; followers: number | null; following: number | null };
  /** Только домен ссылки из шапки (путь бывает телефоном: `wa.me/7999…`). */
  externalUrl: string | null;
  posts: MaterialPost[];
  /** Посчитанное кодом (`ProfileFacts` без подписей и био), только у `apify`. */
  facts: Record<string, unknown> | null;
  /** До `MAX_IMAGES` обложек плюс аватар. */
  images: MaterialImage[];
  /** Факты от заказчика: недоверенный текст, «со слов заказчика». */
  extraFacts: string[];
};

/** Часть пользовательского сообщения: текст или картинка байтами (скачал наш сервер). */
export type PromptPart =
  { type: "text"; text: string } | { type: "image"; data: Uint8Array; mediaType: string };

export type ComedyPrompt = { system: string; parts: readonly PromptPart[] };

/** Вызов модели. Возвращает НЕдоверенный объект: шаг парсит его сам. Сбой сети — исключение. */
export type ComedyGenerateFn = (prompt: ComedyPrompt) => Promise<unknown>;

/** Откуда материал: снимок Apify из БД (прод) или готовый материал (скрипт, тесты). */
export type ComedySource =
  | { kind: "snapshot"; snapshot: ProfileSnapshot; facts: ProfileFacts }
  | { kind: "material"; material: ComedyMaterial };

export type ComedyInput = {
  source: ComedySource;
  /** `avoidTopics ∪ sensitiveEvents` из досье (`forbiddenTopics`); без досье пусто. */
  forbidden: readonly string[];
  /**
   * `sensitiveEvents` досье отдельно (потеря, болезнь, развод, переезд из-за войны): красная
   * линия держится и кодом, слой 4 `sensitive_event` в `punches.ts`. Без досье пусто.
   */
  sensitiveEvents: readonly string[];
  /** Факты от пользователя: недоверенный текст. Для `snapshot` входят в материал. */
  extraFacts: readonly string[];
  mode: GenerationMode;
  level: Level;
  tier: Tier;
  carried?: CarriedPunch[];
};

/** Зависимости движка: всё внешнее инжектируется (тесты без сети и ключа). */
export type ComedyDeps = {
  profile: ComedyGenerateFn;
  insights: ComedyGenerateFn;
  select: ComedyGenerateFn;
  punch: ComedyGenerateFn;
  editor: ComedyGenerateFn;
  moderator: ComedyGenerateFn;
  /** Скачивание обложек и аватара (allowlist CDN, 512 px). Не бросает. */
  fetchCovers: FetchCoversFn;
  /** Модель каждой роли: в трассу и `PunchTrace` (генератор — `writerModel`, редактор — `judgeModel`). */
  models: Record<ComedyRole, string>;
  /** Canary-строки для слоя 4. По умолчанию из `filters/config.ts`. */
  canaries?: readonly string[];
  /** Индекс цепочек слов промптов для слоя 4. По умолчанию по настоящим промптам. */
  leakIndex?: LeakIndex;
  /** Счётчик трат шага. Нет — учёта нет, поведение то же. */
  meter?: CostMeter;
  /** Id нового кандидата; уникальность проверяет код. */
  newId: () => string;
  /** Часы для таймингов подшагов (мс). По умолчанию `performance.now`. */
  now?: () => number;
};
