import { Flames } from "@/components/roast/Flames";

/**
 * Горящий аватар: та же техника, что у FireButton на лендинге (частицы + gooey + вырезы),
 * огонь растёт из-под шарика. Аватар из Instagram — <img>: хосты CDN переменные.
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
      {/* Огонь шириной с аватар, чуть вытянут вверх и поднят на 10 px */}
      <Flames
        particle="sm"
        className="bottom-[66px] left-1/2 h-[170px] w-[120px] -translate-x-1/2 [--rise:-150px]"
      />
      <div
        className="absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center justify-center overflow-hidden rounded-full border-[3px] border-paper bg-pink font-wide text-[44px] leading-none font-black text-ink"
        style={{ width: size, height: size }}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          username[0]?.toUpperCase()
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 text-center font-wide text-[15px] leading-none font-extrabold text-paper">
        @{username}
      </div>
    </div>
  );
}
