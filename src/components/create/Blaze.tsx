import { Flames } from "@/components/roast/Flames";
import { Avatar } from "./Avatar";

/**
 * Горящий аватар: та же техника, что у FireButton на лендинге (частицы + gooey + вырезы),
 * огонь растёт из-под шарика. Аватар из Instagram, без картинки — розовый круг с буквой.
 */
export function Blaze({
  username,
  avatarUrl,
  size = 112,
}: {
  username: string;
  avatarUrl: string | null;
  size?: number;
}) {
  return (
    <div className="relative h-[220px]" aria-hidden="true">
      {/* Огонь уже аватара, вытянут вверх и поднят на 10 px; заголовок над ним (z-20) */}
      <Flames
        particle="sm"
        className="bottom-[66px] left-1/2 h-[150px] w-[90px] -translate-x-1/2 [--rise:-130px]"
      />
      <Avatar
        username={username}
        url={avatarUrl}
        className="absolute bottom-7 left-1/2 -translate-x-1/2 text-[44px]"
        style={{ width: size, height: size }}
      />
      <div className="absolute inset-x-0 bottom-0 text-center font-wide text-[15px] leading-none font-extrabold text-paper">
        @{username}
      </div>
    </div>
  );
}
