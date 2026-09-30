import { Flames } from "@/components/roast/Flames";

/**
 * Горящий аватар: та же техника, что у FireButton на лендинге (частицы + gooey + вырезы),
 * огонь растёт из-под шарика. Пока розовый круг с буквой; аватар из Instagram подключим позже.
 */
export function Blaze({ username, size = 112 }: { username: string; size?: number }) {
  return (
    <div className="relative h-[220px]" aria-hidden="true">
      {/* Огонь шириной с аватар, чуть вытянут вверх и поднят на 10 px */}
      <Flames
        particle="sm"
        className="bottom-[66px] left-1/2 h-[170px] w-[120px] -translate-x-1/2 [--rise:-150px]"
      />
      <div
        className="absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-ink bg-pink font-wide text-[44px] leading-none font-black text-ink"
        style={{ width: size, height: size }}
      >
        {username[0]?.toUpperCase()}
      </div>
      <div className="absolute inset-x-0 bottom-0 text-center font-wide text-[15px] leading-none font-extrabold text-paper">
        @{username}
      </div>
    </div>
  );
}
