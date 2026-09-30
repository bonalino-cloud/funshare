import type { CheckedProfile } from "@/contracts";
import { StepTitle } from "./StepTitle";

/** Экран «Нашли!»: аватар по центру крупно, ник, имя и посты мельче, строка с открытым замком. */
export function ProfileFound({ profile }: { profile: CheckedProfile }) {
  return (
    <>
      <StepTitle accent="!">Нашли</StepTitle>
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
        <div className="mb-2 flex size-24 items-center justify-center overflow-hidden rounded-full border-[3px] border-paper bg-pink font-wide text-4xl font-black text-ink shadow-offset-paper">
          {profile.avatarUrl ? (
            // Аватар отдаёт Instagram с переменных хостов: next/image потребовал бы белый список доменов.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            profile.username[0]?.toUpperCase()
          )}
        </div>
        <div className="font-wide text-[22px] leading-none font-black tracking-tight text-paper">
          @{profile.username}
        </div>
        <div className="type-body text-paper/70">
          {profile.displayName} · {profile.postsCount} постов
        </div>
        <div className="mt-3.5 flex items-center gap-2 type-label text-paper">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-5"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 7.5-2" />
          </svg>
          Готово к прожарке
        </div>
      </div>
    </>
  );
}
