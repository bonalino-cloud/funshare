import { isOurAvatarUrl, type RemoveAvatar } from "./avatar";
import type { ProfileCheckRepository } from "./repository";

export type MinorCleanupDeps = {
  removeAvatar: RemoveAvatar;
  repo: Pick<ProfileCheckRepository, "clearAvatar">;
};

/**
 * Досье показало «младше 16» уже после «Нашли!»: фото несовершеннолетнего не должно остаться в
 * публичном Blob. Удаляем копию аватара и обнуляем ссылку во всех готовых проверках этого ника
 * (копии из кэша указывают на тот же файл). Идемпотентна и не бросает: зовётся на каждый отказ
 * `minor_detected`, поэтому сбой сегодня исправится следующим отказом.
 */
export async function discardMinorAvatar(
  deps: MinorCleanupDeps,
  igUsername: string,
  avatarUrl: string | null,
): Promise<void> {
  try {
    if (isOurAvatarUrl(avatarUrl)) await deps.removeAvatar(avatarUrl);
    await deps.repo.clearAvatar(igUsername);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    console.error(`[profile-check] аватар несовершеннолетнего не удалён${name ? `: ${name}` : ""}`);
  }
}
