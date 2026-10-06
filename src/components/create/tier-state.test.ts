import { describe, expect, it } from "vitest";
import type { TierInfo } from "@/contracts";
import { tierCardState } from "./tier-state";

function tier(overrides: Partial<TierInfo> & Pick<TierInfo, "tier">): TierInfo {
  return {
    listAmount: 0,
    currency: "RUB",
    candidateCount: 10,
    selectCount: 6,
    imageCount: 0,
    available: true,
    video: false,
    ...overrides,
  };
}

describe("tierCardState", () => {
  it("Поджог в первый раз — бесплатно, даже если у тарифа есть цена", () => {
    expect(tierCardState(tier({ tier: 1, listAmount: 4900 }), true)).toEqual({
      disabled: false,
      footer: "Бесплатно",
    });
  });

  it("повтор Поджога с ценой — активен и показывает цену", () => {
    expect(tierCardState(tier({ tier: 1, listAmount: 4900 }), false)).toEqual({
      disabled: false,
      footer: "49 ₽",
    });
  });

  it("повтор Поджога, пока сервер отдаёт цену 0 — «Уже был», неактивен", () => {
    expect(tierCardState(tier({ tier: 1 }), false)).toEqual({ disabled: true, footer: "Уже был" });
  });

  it("Кострище — цена, проба на него не влияет", () => {
    expect(tierCardState(tier({ tier: 2, listAmount: 9900 }), false)).toEqual({
      disabled: false,
      footer: "99 ₽",
    });
  });

  it("недоступный тариф — «Скоро»", () => {
    expect(tierCardState(tier({ tier: 3, available: false }), true)).toEqual({
      disabled: true,
      footer: "Скоро",
    });
  });
});
