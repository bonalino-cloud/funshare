import type { Level, Tier } from "@/contracts";

/** Названия тарифов и степеней живут у FE; BE знает только номера и коды */
export const TIER_NAME: Record<Tier, string> = { 1: "Поджог", 2: "Кострище", 3: "Пекло" };
export const LEVEL_NAME: Record<Level, string> = {
  rare: "Rare",
  medium: "Medium",
  well_done: "Well done",
};
