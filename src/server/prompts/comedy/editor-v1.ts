import type { Structure } from "../../comedy/schema";
import type { ComedyPrompt } from "../../comedy/types";
import { clean, DATA_NOTE, retryTail, textPrompt, unbracket } from "./shared";

// Промпт comedy-движка `comedy/editor-v1` (comedy-engine §7.5). Системный текст перенесён из документа
// дословно. Версия пишется в трассу и в кандидата: любая правка текста ниже = новый файл
// `editor-v2.ts`, а не правка этого (инвариант 12). Canary-метку добавляет код при вызове модели.

export const PROMPT_VERSION = "comedy/editor-v1";

export const EDITOR_SYSTEM = `Ты главный редактор жёсткой прожарки 18+. Перед тобой шутки-кандидаты про одного человека. Оцени каждую и собери итоговый набор самых сильных.

ОЦЕНКИ 0–5
- surprise: неожиданность поворота. Предсказуемый панчлайн, который зритель договорил за комика, 0–1.
- specificity: шутка про конкретно этого человека (его деталь, цитата, факт), а не про любого.
- punch: сила удара. Жёстко, смешно, с матом на месте. Беззубая шутка 0–1.
- rhythm: коротко, одна мысль, панчлайн в конце, ничего лишнего после.
- clarity: понятно без внешнего контекста, логика цела.
- duplicateOf: id более сильной шутки с той же ассоциацией или тем же поворотом, иначе null.
- broken: true, если логика сломана, шутка непонятна или опирается на то, чего нет во входе.

ОТБОР
picked: ровно N id в порядке силы (самая сильная первой). Правила:
- Разные темы и разные ассоциации, ни одной повторяющейся мысли. Из дублей бери сильнейший.
- Не больше M шуток на один инсайт.
- Не бери broken и шутки с clarity ниже 2.
- Шутки из списка «уже выбрано» не повторяй ни по смыслу, ни по ассоциации.
- Не больше двух шуток с одним и тем же матерным словом (охуенно, пиздец, ебучий …) в итоговом наборе.

Верни только JSON по схеме.`;

export type EditorPromptInput = {
  /** Сколько выбрать. */
  n: number;
  /** Не больше стольких на один инсайт. */
  m: number;
  /** Уже выбрано (Поджог, прошлый раунд): не повторять ни по смыслу, ни по ассоциации. */
  alreadyChosen: readonly string[];
  candidates: readonly { id: string; insightId: string; structure: Structure; text: string }[];
  retryNote?: string;
};

/** User-сообщение (§7.5): N, M, «уже выбрано», кандидаты (id, insightId, structure, текст). */
export function buildEditorPrompt(input: EditorPromptInput): ComedyPrompt {
  const chosen = input.alreadyChosen.map((t) => `- ${unbracket(clean(t, 240))}`);
  const candidates = input.candidates.map(
    (c) =>
      `[${c.id}] (инсайт ${clean(c.insightId, 40)}, ${c.structure}) ${unbracket(clean(c.text, 240))}`,
  );
  const user = [
    DATA_NOTE,
    `N = ${input.n}, M = ${input.m}.`,
    `Уже выбрано:\n<already_chosen>\n${chosen.length > 0 ? chosen.join("\n") : "(нет)"}\n</already_chosen>`,
    `<candidates>\n${candidates.join("\n")}\n</candidates>`,
    `Оцени каждую шутку из <candidates> и верни picked: ровно ${input.n} id, не больше ${input.m} на инсайт.${retryTail(input.retryNote)}`,
  ].join("\n\n");
  return textPrompt(EDITOR_SYSTEM, user);
}
