"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Artifact } from "@/contracts";
import { ArtifactCards, cardFile, saveFile } from "@/components/artifact/ArtifactCards";
import { Button } from "@/components/ui/Button";
import { api, toErrorCode } from "@/lib/client/api";
import { roastCards } from "@/lib/client/roast-card";
import { errorLine } from "./errors";
import { IconCheck, IconCopy, IconDownload } from "./icons";
import { StepTitle } from "./StepTitle";

type Flash = "copied" | "saved" | "savedAll" | null;

/** Шаг 7: карточки прожарки 9:16 и шеринг. Вёрстка карточек: `components/artifact`. */
export function ResultScreen({ slug }: { slug: string }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState<"share" | "save" | "saveAll" | null>(null);
  const [index, setIndex] = useState(0);
  /** Готовые PNG по номеру карточки: «Поделиться» на iOS теряет жест, если ждать отрисовку. */
  const files = useRef(new Map<number, Promise<File>>());

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

  const fileAt = useCallback(
    (i: number) => {
      const card = cards[i];
      if (!card) return Promise.reject(new Error("card"));
      let f = files.current.get(i);
      if (!f) {
        f = cardFile(card, slug, i + 1);
        f.catch(() => files.current.delete(i));
        files.current.set(i, f);
      }
      return f;
    },
    [cards, slug],
  );

  // Готовим PNG текущей карточки заранее, пока человек смотрит на неё
  useEffect(() => {
    if (cards.length) fileAt(index).catch(() => undefined);
  }, [cards, index, fileAt]);

  const url = typeof window === "undefined" ? `/a/${slug}` : `${window.location.origin}/a/${slug}`;
  const shareText = artifact?.kind === "roast_v1" ? artifact.content.shareText : undefined;

  function show(f: Flash) {
    setFlash(f);
    setTimeout(() => setFlash(null), 2200);
  }

  async function share() {
    if (busy) return;
    setBusy("share");
    try {
      const file = await fileAt(index).catch(() => null);
      const withFile = file && navigator.canShare?.({ files: [file] });
      if (navigator.share) {
        await navigator.share(
          withFile
            ? { files: [file], text: shareText, url }
            : { title: "Прожарка", text: shareText, url },
        );
        return;
      }
      await copy();
    } catch {
      // человек закрыл системное меню: ничего не делаем
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      show("copied");
    } catch {
      window.prompt("Скопируй ссылку", url);
    }
  }

  async function save() {
    if (busy) return;
    setBusy("save");
    try {
      saveFile(await fileAt(index));
      show("saved");
    } catch {
      setError("Не получилось сохранить картинку. Попробуй ещё раз");
    } finally {
      setBusy(null);
    }
  }

  async function saveAll() {
    if (busy) return;
    setBusy("saveAll");
    try {
      for (const i of cards.keys()) {
        saveFile(await fileAt(i));
        // Браузеры режут пачку загрузок без паузы между ними
        await new Promise((r) => setTimeout(r, 250));
      }
      show("savedAll");
    } catch {
      setError("Не получилось сохранить картинки. Попробуй ещё раз");
    } finally {
      setBusy(null);
    }
  }

  if (error && !artifact) {
    return (
      <>
        <StepTitle size="m">Не открылось</StepTitle>
        <p className="border-l-2 border-red pl-3 type-body text-paper">{error}</p>
      </>
    );
  }

  return (
    <>
      <StepTitle size="m">Готово. Листай</StepTitle>
      {cards.length ? (
        <ArtifactCards cards={cards} onIndex={setIndex} reserve={410} />
      ) : (
        <p className="type-body text-paper/60">Открываем…</p>
      )}
      {error && <p className="border-l-2 border-red pl-3 type-body text-paper">{error}</p>}
      <div className="mt-auto flex flex-col gap-3 pt-4">
        <Button
          type="button"
          variant="inverse"
          look="display"
          arrow={false}
          className="h-14 w-full"
          onClick={share}
          disabled={!cards.length}
          aria-busy={busy === "share" || undefined}
        >
          Поделиться
        </Button>
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            variant="ghost"
            look="display"
            arrow={false}
            className="h-12 gap-1.5 px-2 text-xs!"
            onClick={save}
            disabled={!cards.length || busy !== null}
            aria-busy={busy === "save" || undefined}
            aria-label="Скачать эту карточку"
          >
            {flash === "saved" ? (
              <IconCheck className="size-4 shrink-0" />
            ) : (
              <IconDownload className="size-4 shrink-0" />
            )}
            {flash === "saved" ? "Готово" : "Эту"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            look="display"
            arrow={false}
            className="h-12 gap-1.5 px-2 text-xs!"
            onClick={saveAll}
            disabled={cards.length < 2 || busy !== null}
            aria-busy={busy === "saveAll" || undefined}
            aria-label="Скачать все карточки"
          >
            {flash === "savedAll" ? (
              <IconCheck className="size-4 shrink-0" />
            ) : (
              <IconDownload className="size-4 shrink-0" />
            )}
            {flash === "savedAll" ? "Готово" : busy === "saveAll" ? "Качаем…" : "Все"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            look="display"
            arrow={false}
            className="h-12 gap-1.5 px-2 text-xs!"
            onClick={copy}
            aria-label="Скопировать ссылку"
          >
            {flash === "copied" ? (
              <IconCheck className="size-4 shrink-0" />
            ) : (
              <IconCopy className="size-4 shrink-0" />
            )}
            {flash === "copied" ? "Готово" : "Ссылка"}
          </Button>
        </div>
      </div>
    </>
  );
}
