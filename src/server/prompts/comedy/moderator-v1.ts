import type { ComedyPrompt } from "../../comedy/types";
import { clean, DATA_NOTE, forbiddenBlock, retryTail, textPrompt, unbracket } from "./shared";

// Промпт comedy-движка `comedy/moderator-v1` (comedy-engine §7.6). Системный текст перенесён из документа
// дословно. Версия пишется в трассу и в кандидата: любая правка текста ниже = новый файл
// `moderator-v2.ts`, а не правка этого (инвариант 12). Canary-метку добавляет код при вызове модели.

export const PROMPT_VERSION = "comedy/moderator-v1";

export const MODERATOR_SYSTEM = `Ты модератор жёсткой прожарки 18+. Жёсткость, мат, секс, шутки про член, внешность, лицо, тело, вес, спорт, деньги и привычки здесь РАЗРЕШЕНЫ: за это их не вычёркивай и не оценивай «обидно или нет». Ты проверяешь только две вещи у каждой шутки.

1. hitsClosedTopic: шутка задевает закрытую тему, прямо или намёком. Закрытые темы: болезни, диагнозы, инвалидность (в том числе психические); дети; национальность, этнос, раса; религия; политика, война; ориентация (в том числе «гей», «пидор» и намёки на гомосексуальность); смерть близких, развод, переезд из-за войны; а также темы из списка «нельзя» во входе. Задевает: true.
НЕ закрытые темы, за них не вычёркивай: деньги, цены, траты, доход, бизнес, продажи, бренды и покупки; медитация, йога, «духовность», ретриты, просветление как образ жизни или товар (религия — это конкретная вера, бог, церковь, священные тексты, обряды); алкоголь, вечеринки, секс, внешность, тело.
2. selfContained: шутка понятна без внешнего контекста и её логика цела (подводка и панчлайн связаны, нет оборванной мысли). Понятна и цела: true.

Верни вердикт на каждую шутку, id как во входе. Только JSON по схеме.`;

export type ModeratorPromptInput = {
  forbidden: readonly string[];
  candidates: readonly { id: string; text: string }[];
  retryNote?: string;
};

/**
 * User-сообщение: список «нельзя» и шутки. Модератор не видит профиль и инсайты: «понятна без
 * внешнего контекста» проверяется по тому же, что увидит человек, то есть по одному тексту.
 */
export function buildModeratorPrompt(input: ModeratorPromptInput): ComedyPrompt {
  const candidates = input.candidates.map((c) => `[${c.id}] ${unbracket(clean(c.text, 240))}`);
  const user = [
    DATA_NOTE,
    forbiddenBlock(input.forbidden),
    `<candidates>\n${candidates.join("\n")}\n</candidates>`,
    `Верни вердикт на каждую шутку из <candidates>.${retryTail(input.retryNote)}`,
  ].join("\n\n");
  return textPrompt(MODERATOR_SYSTEM, user);
}
