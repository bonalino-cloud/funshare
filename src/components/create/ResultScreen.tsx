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

  /** Вторичные кнопки: иконка слева от подписи, линия толще стандартной Tabler */
  const tool = "h-12 min-w-0 gap-1 px-1 text-[11px]!";
  const ico = (done: boolean, Icon: typeof IconDownload) =>
    done ? (
      <IconCheck className="size-5" strokeWidth={2.75} />
    ) : (
      <Icon className="size-5" strokeWidth={2.75} />
    );

  return (
    <>
      {artifact && (
        <div className="mb-4 flex w-full flex-col items-center gap-1 text-center">
          <Avatar url={artifact.subject.avatarUrl} name={artifact.subject.username} />
          <div className="text-sm text-paper/80">{artifact.subject.displayName}</div>
          <StepTitle size="s" className="mb-0! w-full">
            Прожарен
          </StepTitle>
        </div>
      )}
      {cards.length ? (
        <ArtifactCards cards={cards} onIndex={setIndex} reserve={375} />
      ) : (
        <p className="type-body text-paper/60">Открываем…</p>
      )}
      {error && <p className="border-l-2 border-red pl-3 type-body text-paper">{error}</p>}
      {/* Кнопки закреплены внизу: колода крупная, на коротком экране страница прокручивается под ними */}
      <div className="sticky bottom-0 z-30 -mx-[18px] mt-auto flex flex-col gap-2 bg-linear-to-t from-surface from-70% to-transparent px-[18px] pt-5 pb-[max(20px,env(safe-area-inset-bottom))]">
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
            className={tool}
            icon={ico(flash === "saved", IconDownload)}
            onClick={save}
            disabled={!cards.length || busy !== null}
            aria-busy={busy === "save" || undefined}
            aria-label="Скачать эту карточку"
          >
            Эту
          </Button>
          <Button
            type="button"
            variant="ghost"
            look="display"
            arrow={false}
            className={tool}
            icon={ico(flash === "savedAll", IconDownload)}
            onClick={saveAll}
            disabled={cards.length < 2 || busy !== null}
            aria-busy={busy === "saveAll" || undefined}
            aria-label="Скачать все карточки"
          >
            {busy === "saveAll" ? "…" : "Все"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            look="display"
            arrow={false}
            className={tool}
            icon={ico(flash === "copied", IconCopy)}
            onClick={copy}
            aria-label="Скопировать ссылку"
          >
            Ссылка
          </Button>
        </div>
      </div>
    </>
  );
}

/** Аватар из профиля; не загрузился (Instagram режет хотлинк) — розовый круг с буквой, как на шаге 1. */
function Avatar({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  const cls = "size-11 rounded-full border-[3px] border-ink";
  if (!url || broken) {
    return (
      <div
        className={`${cls} flex items-center justify-center bg-pink font-wide text-xl font-black text-ink`}
        aria-hidden="true"
      >
        {name[0]?.toUpperCase()}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={`${cls} object-cover`} onError={() => setBroken(true)} />;
}
