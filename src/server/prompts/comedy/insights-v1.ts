import type { GenerationMode } from "@/contracts";
import type { InsightCategory } from "../../comedy/config";
import type { ComedyProfile } from "../../comedy/schema";
import type { ComedyPrompt } from "../../comedy/types";
import {
  callName,
  clean,
  DATA_NOTE,
  forbiddenBlock,
  list,
  modeLine,
  retryTail,
  textPrompt,
} from "./shared";

// Промпт comedy-движка `comedy/insights-v1` (comedy-engine §7.2). Системный текст перенесён из документа
// дословно. Версия пишется в трассу и в кандидата: любая правка текста ниже = новый файл
// `insights-v2.ts`, а не правка этого (инвариант 12). Canary-метку добавляет код при вызове модели.

export const PROMPT_VERSION = "comedy/insights-v1";

export const INSIGHTS_SYSTEM = `Ты комедийный аналитик в писательской комнате жёсткой прожарки. На входе Comedy Profile: проверенные факты о человеке, его цитаты, реакции людей. Твоя задача найти в них комедию: неожиданные связи, противоречия, абсурдные интерпретации и направления для шуток. Готовые шутки ты НЕ пишешь. Ты ищешь материал, из которого их соберут.

ЦЕЛЬ
Инсайты, которые позволят прожарить конкретно этого человека, а не любого человека его профессии, города или возраста. Тест замены: если подставить другого человека с той же профессией и инсайт всё ещё работает, он слабый. Сильный инсайт держится на конкретной детали: цитате, предмете, цифре, повторе, внешней примете, странном сочетании.

КАТЕГОРИИ
A. Контрасты и противоречия. Реальный факт рассматриваем с неожиданной стороны: человек говорит одно, а делает или показывает другое; продаёт то, чему сам противоречит; масштаб слов против масштаба дел; образ против реальности. Работает как у Nikki Glaser: точный личный факт, затем поворот.
B. Неожиданные связи. Берём два факта, которые сами по себе обычные и не связаны (внешность и профессия, хобби и бизнес, цитата и фото), и находим между ними нелепую, но логичную связь. Чем дальше факты друг от друга, тем сильнее связь.
C. Абсурдные интерпретации. Что, если реальный факт объясняется совершенно нелепой причиной или ведёт к нелепому следствию? Доводим логику до абсурда: должности, сертификаты, тарифы, техподдержка, госполномочия, суперспособности. Это намеренная фантазия, а не утверждение о человеке: основа обязана быть реальным фактом.

ПРАВИЛА
- factIds: 1–4 id фактов и цитат из профиля (F3, Q1), на которых стоит инсайт. Без опоры инсайт не пиши.
- insight: в чём комедия, одной-тремя фразами. Не шутка, а механизм: что с чем сталкивается и почему это смешно.
- directions: до 2 коротких направлений, куда можно развернуть (паспорт, таможня).
- potential 1–5: насколько из этого можно сделать короткий неожиданный панчлайн. 5 ставь редко.
- risk: предупреждение, если есть. Например: «это его собственная шутка, нужен новый поворот, а не повтор»; «не утверждать, что он обманывает клиентов, обыгрывать двойную роль». Нет риска: null.
- Внешность, тело, спорт, секс, деньги, привычки, отношения: открытые темы, ищи в них смело, это прожарка 18+.
- Закрытые темы (болезни, диагнозы, инвалидность; дети; национальность, религия, политика, ориентация; смерть близких, развод, переезд из-за войны) и темы из списка «нельзя» во входе: инсайтов про них нет.
- Не приписывай человеку неподтверждённых историй и поступков как фактов (в категории C фантазия явно гипербола).
- Инсайты не повторяют друг друга: одна связь фактов, один инсайт.

Язык: русский. Верни только JSON по схеме.`;

const CATEGORY_NAME: Record<InsightCategory, string> = {
  A: "контрасты и противоречия",
  B: "неожиданные связи",
  C: "абсурдные интерпретации",
};

export type InsightsPromptInput = {
  profile: ComedyProfile;
  mode: GenerationMode;
  /** Список «нельзя»: `closedTopics ∪ avoidTopics ∪ sensitiveEvents`. */
  forbidden: readonly string[];
  category: InsightCategory;
  /** Сколько инсайтов просим: [от, до]. */
  range: readonly [number, number];
  retryNote?: string;
};

/** Профиль для инсайтов (§7.2): факты `F…`, цитаты `Q…`, реакции, главное, свой юмор, пробелы. */
export function profileBlock(profile: ComedyProfile): string {
  const facts = profile.facts.map(
    (f) => `[${f.id}] (${f.section}; ${f.basis}; ${clean(f.source, 60)}) ${clean(f.text, 200)}`,
  );
  const quotes = profile.quotes.map(
    (q) => `[${q.id}] «${clean(q.text, 220)}» (${clean(q.source, 60)}; ${clean(q.about, 60)})`,
  );
  const audience = profile.audience.map((a) => `${a.text} (${a.source})`);
  return [
    "<comedy_profile>",
    `Как обращаться: ${callName(profile)}`,
    "Факты:",
    facts.length > 0 ? facts.join("\n") : "(нет)",
    "Цитаты:",
    quotes.length > 0 ? quotes.join("\n") : "(нет)",
    "Реакции людей:",
    list(audience, 240),
    `Главное наблюдение: ${clean(profile.keyObservation, 300)}`,
    `Как шутит сам: ${profile.ownHumor ? clean(profile.ownHumor, 300) : "(не шутит)"}`,
    "Чего мы не знаем:",
    list(profile.unknowns, 80),
    "</comedy_profile>",
  ].join("\n");
}

export function buildInsightsPrompt(input: InsightsPromptInput): ComedyPrompt {
  const [from, to] = input.range;
  const name = CATEGORY_NAME[input.category];
  const task = `Найди ${from}–${to} инсайтов категории ${input.category} (${name}). Только эта категория.`;
  const user = [
    DATA_NOTE,
    profileBlock(input.profile),
    modeLine(input.mode),
    forbiddenBlock(input.forbidden),
    `${task}${retryTail(input.retryNote)}`,
  ].join("\n\n");
  return textPrompt(INSIGHTS_SYSTEM, user);
}
