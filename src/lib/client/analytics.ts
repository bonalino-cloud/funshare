import type { ErrorCode, GenerationMode, Level, Tier } from "@/contracts";
import type { StoryShareResult } from "./stories";

/**
 * Продуктовые события воронки. Экраны знают только `track(тип, параметры)`; куда событие уходит,
 * решает этот файл. Сейчас это цели Яндекс Метрики (счётчик из `NEXT_PUBLIC_YM_ID`); свой приёмник
 * `POST /api/e` (architecture/roast-engine.md §9.6) заменит только отправку, вызовы останутся.
 *
 * В параметрах нет ника, ссылки на профиль, текста шуток и фактов: только тариф, степень, режим
 * и коды. Счётчика нет (локалка, превью) — события никуда не уходят.
 */

/** Какая кнопка «Прожарить» на лендинге. */
export type StartPlace = "hero" | "sticky" | "final" | "history";
/** Разделы лендинга по `id` секций. */
export const LANDING_SECTIONS = [
  "levels",
  "video",
  "degrees",
  "how",
  "when",
  "rules",
  "faq",
  "start",
] as const;
export type LandingSection = (typeof LANDING_SECTIONS)[number];
/** Шаги 1–5 флоу создания (`CreateStep`). */
export type FlowStep = "profile" | "facts" | "tier" | "level" | "checkout";

type NoParams = Record<never, never>;

export type TrackEvents = {
  /** Лендинг: нажал «Прожарить». */
  start_click: { place: StartPlace };
  /** Лендинг: доскроллил до раздела. */
  section_view: { section: LandingSection };
  /** Флоу создания: открылся шаг. */
  step_view: { step: FlowStep };
  /** Начал вводить ссылку на профиль. */
  input_start: NoParams;
  /** Отправил ссылку на проверку. */
  url_submitted: { mode: GenerationMode };
  /** Итог проверки профиля: `ok` или код отказа. */
  profile_checked: { result: "ok" | ErrorCode };
  tier_selected: { tier: Tier };
  level_selected: { level: Level };
  /** «Волшебное слово» подошло. */
  promo_applied: NoParams;
  /** Нажал «Прожарить» на последнем шаге. */
  pay_click: { tier: Tier; level: Level; mode: GenerationMode; free: boolean };
  /** Запуск не прошёл: `payment_required` — хотел платный тариф, оплаты ещё нет. */
  start_failed: { reason: ErrorCode };
  generation_started: {
    tier: Tier;
    level: Level;
    mode: GenerationMode;
    facts: number;
    promo: boolean;
  };
  /** Не первая прожарка в этом браузере: что было в прошлый раз и что выбрано теперь. */
  repeat_started: {
    tierFrom: Tier;
    tierTo: Tier;
    levelFrom: Level;
    levelTo: Level;
    sameProfile: boolean;
  };
  /** Открылся выбор шуток. */
  selection_view: NoParams;
  selection_submitted: NoParams;
  /** Дождался: генерация стала готовой на открытом экране ожидания. */
  result_waited: NoParams;
  /** Открыт экран результата, в том числе повторно из «Моих прожарок». */
  result_view: NoParams;
  generation_failed: { reason: ErrorCode };
  /** «Поделиться» в сторис: с экрана результата или из просмотра карточки. */
  story_share: { place: "result" | "viewer"; result: StoryShareResult | "error" };
  copy_link: NoParams;
  save_all: NoParams;
  /** «Ещё раз»: после готовой прожарки или после сбоя. */
  again_click: { place: "result" | "failed" };
  /** Открыта публичная страница прожарки `/a/[slug]`. */
  artifact_view: NoParams;
  /** «Прожарь в ответ» на публичной странице. */
  cta_click: NoParams;
};

export type TrackEventType = keyof TrackEvents;

/**
 * У этих событий вариант входит в имя цели (`step_view_tier`, `start_click_hero`): воронку в
 * Метрике собирают из отдельных целей, а не из параметров визита.
 */
const GOAL_VARIANT: { [T in TrackEventType]?: keyof TrackEvents[T] & string } = {
  start_click: "place",
  section_view: "section",
  step_view: "step",
  again_click: "place",
};

type Params = Record<string, string | number | boolean>;

/** Идентификатор цели в Метрике для события. */
export function goalId(type: TrackEventType, params: Params = {}): string {
  const key = GOAL_VARIANT[type];
  return key === undefined ? type : `${type}_${String(params[key])}`;
}

type Ym = {
  (id: number, method: string, ...args: unknown[]): void;
  /** Очередь вызовов до загрузки tag.js. */
  a?: unknown[][];
  l?: number;
};

declare global {
  interface Window {
    ym?: Ym;
  }
}

const TAG_URL = "https://mc.yandex.ru/metrika/tag.js";

/** Номер счётчика из окружения; `null` — счётчика нет или в переменной не число. */
export function metrikaId(): number | null {
  const raw = process.env.NEXT_PUBLIC_YM_ID ?? "";
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

function ym(method: string, ...args: unknown[]) {
  const id = metrikaId();
  if (id === null || typeof window === "undefined") return;
  try {
    window.ym?.(id, method, ...args);
  } catch {
    // Аналитика не роняет экран: счётчик могли подменить или сломать блокировщики
  }
}

/**
 * Стандартный код счётчика: очередь `ym.a`, пока грузится tag.js, и `init`. Первый просмотр
 * страницы шлёт сам `init`. Повторный вызов ничего не делает.
 */
export function initMetrika(): void {
  const id = metrikaId();
  if (id === null || typeof window === "undefined" || window.ym) return;
  const queue: Ym = (...args) => {
    (queue.a ??= []).push(args);
  };
  queue.l = Date.now();
  window.ym = queue;
  const script = document.createElement("script");
  script.async = true;
  script.src = TAG_URL;
  document.head.appendChild(script);
  queue(id, "init", {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
  });
}

/** Переход между страницами без перезагрузки: Метрика сама его не видит. */
export function trackPage(url: string, referer: string): void {
  ym("hit", url, { referer });
}

export function track<T extends TrackEventType>(
  type: T,
  ...[params]: NoParams extends TrackEvents[T] ? [] : [TrackEvents[T]]
): void {
  if (process.env.NODE_ENV !== "production") console.debug("[track]", type, params ?? {});
  ym("reachGoal", goalId(type, params), params);
}

/**
 * Классы Вебвизора для личного: ввод в поле уходит звёздочками, содержимое блока не пишется.
 * Ник, аватар, факты и тексты шуток в записи сессий не попадают.
 */
export const PRIVATE_INPUT = "ym-disable-keys";
export const PRIVATE_BLOCK = "ym-hide-content";
