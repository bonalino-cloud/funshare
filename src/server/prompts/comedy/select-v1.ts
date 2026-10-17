import type { ComedyProfile, Insight } from "../../comedy/schema";
import type { ComedyPrompt } from "../../comedy/types";
import {
  callName,
  clean,
  DATA_NOTE,
  factLines,
  delicateBlock,
  forbiddenBlock,
  insightFacts,
  retryTail,
  textPrompt,
} from "./shared";

// Промпт comedy-движка `comedy/select-v1` (comedy-engine §7.3). Системный текст перенесён из документа
// дословно. Версия пишется в трассу и в кандидата: любая правка текста ниже = новый файл
// `select-v2.ts`, а не правка этого (инвариант 12). Canary-метку добавляет код при вызове модели.

export const PROMPT_VERSION = "comedy/select-v1";

export const SELECT_SYSTEM = `Ты главный редактор писательской комнаты жёсткой прожарки. Перед тобой комедийные инсайты о человеке. Выбери самые перспективные и расставь по силе.

КАК ОЦЕНИВАТЬ
Не необычность идеи, а возможность получить короткий и действительно неожиданный панчлайн про конкретно этого человека. Хороший инсайт всё ещё можно испортить предсказуемым панчлайном, поэтому выше те, где поворот очевиден редактору, но не зрителю.
- score 1–10: потенциал панчлайна.
- mechanic: механика одним-тремя словами (абсурдная экономика, буквальное прочтение, логический парадокс, столкновение фактов, противоречие, двойное значение, ирония ситуации, гипербола, абсурдное следствие, несовместимые образы).
- theme: тема одним-двумя словами (деньги, усы, просветление, пляжи).

ПРАВИЛА ОТБОРА
- Выбери ровно 15 (или все, если меньше), упорядочи по убыванию силы. Первые 10 пойдут в работу, 5 в запас.
- Разные темы: в первых 10 не больше одного инсайта на тему и не больше одного на одну и ту же связку фактов.
- Разные темы по сути, а не по словам: два инсайта про одно и то же (например, «лайки против масштаба» и «аудитория против масштаба») считаются одной темой.
- Если в профиле есть заметная внешность, хотя бы 2 из первых 10 про внешность или тело.
- Если есть дословные цитаты, хотя бы 1 из первых 10 построен на цитате.
- Инсайт, который повторяет собственную шутку человека без нового поворота, не бери.

Верни только JSON по схеме.`;

export type SelectPromptInput = {
  profile: ComedyProfile;
  insights: readonly Insight[];
  /** Список «нельзя»: `sensitiveEvents ∪ closedTopics`. */
  forbidden: readonly string[];
  /** Деликатно, лучше обходить: `avoidTopics` досье. */
  delicate: readonly string[];
  /** Сколько выбрать (15 или все, если меньше). */
  count: number;
  retryNote?: string;
};

/**
 * User-сообщение (§7.3): инсайты (id, категория, title, факты одной строкой, insight, potential,
 * risk), обращение и список «нельзя».
 */
export function buildSelectPrompt(input: SelectPromptInput): ComedyPrompt {
  const lines = factLines(input.profile);
  const insights = input.insights.map((i) =>
    [
      `[${i.id}] категория ${i.category}: ${clean(i.title, 60)}`,
      `факты: ${insightFacts(i, lines).join("; ") || "(нет)"}`,
      `инсайт: ${clean(i.insight, 240)}`,
      `potential: ${i.potential}`,
      `risk: ${i.risk ? clean(i.risk, 120) : "нет"}`,
    ].join("\n"),
  );
  const user = [
    DATA_NOTE,
    `Герой: ${callName(input.profile)}`,
    forbiddenBlock(input.forbidden),
    ...delicateBlock(input.delicate),
    `<insights>\n${insights.join("\n\n")}\n</insights>`,
    `Выбери ${input.count} инсайтов из <insights> и расставь по убыванию силы. Инсайты, которые задевают темы из списка «нельзя», не бери. id как во входе.${retryTail(input.retryNote)}`,
  ].join("\n\n");
  return textPrompt(SELECT_SYSTEM, user);
}
