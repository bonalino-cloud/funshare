"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Artifact } from "@/contracts";
import { FunshareLogo } from "@/components/brand/FunshareLogo";
import { errorLine } from "@/components/create/errors";
import { FlameVortex } from "@/components/roast/FlameVortex";
import { api, toErrorCode } from "@/lib/client/api";
import { roastCards } from "@/lib/client/roast-card";
import { ArtifactCards } from "./ArtifactCards";

/**
 * Публичная страница `/a/[slug]`: её открывает тот, кому прислали ссылку. Карточки
 * свайпом и главный вирусный вход — «Прожарь в ответ».
 */
export function ArtifactPage({ slug }: { slug: string }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getArtifact(slug)
      .then((a) => alive && setArtifact(a))
      .catch((e: unknown) => alive && setError(errorLine(toErrorCode(e))));
    return () => {
      alive = false;
    };
  }, [slug]);

  const cards = useMemo(() => (artifact ? roastCards(artifact) : []), [artifact]);

  return (
    <div
      data-surface="dark"
      className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-surface text-on-surface"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <FlameVortex />
        <div className="grain absolute inset-0" />
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-5 px-[18px] pt-6 pb-[max(40px,env(safe-area-inset-bottom))]">
        <header className="flex items-center justify-between">
          <Link href="/roast" aria-label="Funshare — на главную">
            <FunshareLogo className="h-7 w-auto text-paper" />
          </Link>
          {artifact && (
            <span className="font-wide text-sm font-bold text-paper/80">
              @{artifact.subject.username}
            </span>
          )}
        </header>
        <main className="flex flex-1 flex-col gap-5">
          {error ? (
            <p className="border-l-2 border-red pl-3 type-body text-paper">{error}</p>
          ) : cards.length ? (
            <ArtifactCards
              cards={cards}
              slug={slug}
              shareText={artifact?.kind === "roast_v1" ? artifact.content.shareText : undefined}
              reserve={230}
            />
          ) : (
            <p className="type-body text-paper/60">Открываем…</p>
          )}
          <Link
            href="/create"
            className="mt-auto flex h-16 w-full items-center justify-center rounded-md bg-paper font-wide text-lg font-extrabold text-ink uppercase transition-transform active:scale-[0.98]"
          >
            Прожарь в ответ
          </Link>
        </main>
      </div>
    </div>
  );
}
