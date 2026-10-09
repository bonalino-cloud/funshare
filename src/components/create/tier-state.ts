import type { TierInfo } from "@/contracts";
import { formatRub } from "@/lib/client/money";

export type TierCardState = { disabled: boolean; footer: string };

/**
 * Что показать на карточке тарифа. Поджог: первый раз бесплатно (`freeTrialAvailable`), повтор —
 * по цене тарифа. Пока сервер отдаёт Поджогу цену 0, повтора нет: «Уже был», карточка неактивна.
 * Пекло — заглушка до конца MVP.
 */
export function tierCardState(info: TierInfo, freeTrialAvailable: boolean): TierCardState {
  if (!info.available) return { disabled: true, footer: "Скоро" };
  if (info.tier === 1 && freeTrialAvailable) return { disabled: false, footer: "Бесплатно" };
  if (info.listAmount === 0) {
    return info.tier === 1
      ? { disabled: true, footer: "Уже был" }
      : { disabled: false, footer: "Бесплатно" };
  }
  return { disabled: false, footer: formatRub(info.listAmount) };
}
