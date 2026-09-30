"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Artifact } from "@/contracts";
import { Button } from "@/components/ui/Button";
import { api, toErrorCode } from "@/lib/client/api";
import { errorLine } from "./errors";
import { StepTitle } from "./StepTitle";

/**
 * Шаг 7, механика: показать артефакт и поделиться. Внешний вид артефакта и карточек
 * шеринга придёт из Figma (fe/p2-share-cards), здесь простая вёрстка данных.
 */
export function ResultScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const url = typeof window === "undefined" ? `/a/${slug}` : `${window.location.origin}/a/${slug}`;
  const shareText = artifact?.kind === "roast_v1" ? artifact.content.shareText : undefined;

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Прожарка", text: shareText, url });
        return;
      }
    } catch {
      // человек закрыл системное меню: ничего не делаем
      return;
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Скопируй ссылку", url);
    }
  }

  if (error) {
    return (
      <>
        <StepTitle size="m">Не открылось</StepTitle>
        <p className="border-l-2 border-red pl-3 type-body text-paper">{error}</p>
      </>
    );
  }

  const content = artifact?.kind === "roast_v1" ? artifact.content : null;
  const hero = artifact?.images.find((i) => i.role === "hero");

  return (
    <>
      <StepTitle accent="Смотри, что вышло" size="m">
        Готово.
      </StepTitle>
      <div className="flex flex-col gap-2">
        {hero && (
          <div className="h-[180px] overflow-hidden rounded-lg border-2 border-ink">
            {/* Картинки артефакта из Blob: домены переменные, поэтому <img> */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hero.url} alt={hero.alt} className="size-full object-cover" />
          </div>
        )}
        {content ? (
          <>
            <div className="rounded-md bg-paper px-3 py-2.5 text-ink">
              <div className="font-wide text-sm leading-tight font-extrabold uppercase">
                {content.title}
              </div>
              <div className="type-body">{content.tagline}</div>
            </div>
            {content.punches.map((p) => (
              <div key={p.id} className="rounded-md bg-paper px-3 py-2.5 type-body text-ink">
                {p.emoji} {p.text}
              </div>
            ))}
            <p className="px-1 pt-1 type-body text-paper/80">{content.finale}</p>
          </>
        ) : (
          <p className="type-body text-paper/60">Открываем…</p>
        )}
      </div>
      <div className="mt-auto flex flex-col gap-2 pt-4">
        <Button
          type="button"
          variant="inverse"
          look="display"
          arrow={false}
          className="h-14 w-full"
          onClick={share}
          disabled={!artifact}
        >
          Поделиться
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="ghost" className="h-11" arrow={false} onClick={copy}>
            {copied ? "Скопировано. Кидай" : "Скопировать ссылку"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            arrow={false}
            onClick={() => router.push("/create")}
          >
            Ещё раз
          </Button>
        </div>
      </div>
    </>
  );
}
