import type { Level } from "@/contracts";
import medium from "./assets/level-medium.png";
import rare from "./assets/level-rare.png";
import well from "./assets/level-well.png";

/** Картинки степеней прожарки: карточки шага 4 и лоудер генерации берут одни и те же. */
export const LEVEL_ART: Record<Level, typeof rare> = { rare, medium, well_done: well };
