import type { Layer5Code } from "../filters";
import type { ModeratorItem } from "./schema";

/**
 * Слой 5 (roast-engine §6): по вердикту модератора — причина вычёркивания или `null`, если
 * кандидата можно показывать. Порядок: тема из запретных важнее прочего (самый тяжёлый провал).
 */
export function moderationReason(v: ModeratorItem): Layer5Code | null {
  if (v.hitsForbiddenTopic) return "forbidden_topic";
  if (!v.aboutBehavior) return "not_behavior";
  if (!v.friendSafe) return "not_friend_safe";
  if (!v.selfContained) return "unclear";
  return null;
}
