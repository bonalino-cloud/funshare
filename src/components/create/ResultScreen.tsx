"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Artifact } from "@/contracts";
import { ArtifactCards, cardFile, saveFile } from "@/components/artifact/ArtifactCards";
import { CoBrand } from "@/components/artifact/CoBrand";
import { cx } from "@/components/cx";
import { Button } from "@/components/ui/Button";
import { api, toErrorCode } from "@/lib/client/api";
import { roastCards } from "@/lib/client/roast-card";
import { STORY_HINT, shareToStories } from "@/lib/client/stories";
import { errorLine } from "./errors";
import { IconBrandInstagram, IconCheck, IconDownload, IconLink, IconReload } from "./icons";
import { StepTitle } from "./StepTitle";

type Flash = "copied" | "savedAll" | null;

/** Шаг 7: карточки прожарки 9:16 и шеринг. Вёрстка карточек: `components/artifact`. */
export function ResultScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState<"share" | "saveAll" | null>(null);
  const [index, setIndex] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
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

  function showHint(text: string) {
    setHint(text);
    setTimeout(() => setHint(null), 5000);
  }

  function show(f: Flash) {
    setFlash(f);
    setTimeout(() => setFlash(null), 2200);
  }

  /** В Instagram Stories: PNG текущей карточки в системное меню, ссылка в буфер под стикер. */
  async function share() {
    if (busy) return;
    setBusy("share");
    try {
      const result = await shareToStories(await fileAt(index), url, saveFile);
      if (result !== "cancelled") showHint(STORY_HINT[result]);
    } catch {
      setError("Не получилось подготовить картинку. Попробуй ещё раз");
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
  // Чёрная заливка вместо прозрачной у ghost: кнопки не просвечивают огнём фона
  const tool = "h-14 min-w-0 gap-2 bg-ink! px-2 text-xs! whitespace-nowrap";
  const ico = (done: boolean, Icon: typeof IconDownload) =>
    done ? (
      <IconCheck className="size-5" strokeWidth={2.75} />
    ) : (
      <Icon className="size-5" strokeWidth={2.75} />
    );

  return (
    <>
      {/* Карточки в фокусе: видимого заголовка нет, только для скринридера */}
      <h1 className="sr-only">Прожарка готова</h1>
      {artifact && (
        <div className="mt-2 mb-9">
          <CoBrand username={artifact.subject.username} />
        </div>
      )}
      {cards.length ? (
        // Колода по центру свободной высоты: на высоких экранах ширину режет колонка, а не высота
        <div className="flex flex-1 flex-col justify-center">
          <ArtifactCards cards={cards} slug={slug} onIndex={setIndex} reserve={300} />
        </div>
      ) : (
        <p className="type-body text-paper/60">Открываем…</p>
      )}
      {error && <p className="border-l-2 border-red pl-3 type-body text-paper">{error}</p>}
      {/* Кнопки закреплены внизу: колода крупная, на коротком экране страница прокручивается под ними */}
      <div className="sticky bottom-0 z-30 -mx-[18px] mt-auto flex flex-col gap-2 px-[18px] pt-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        {hint && (
          <p className="text-center type-body text-paper" aria-live="polite">
            {hint}
          </p>
        )}
        <div className="flex gap-2">
          {/* «Ещё раз» = новая генерация: квадрат в стиле «Поделиться», только иконка */}
          <Button
            type="button"
            variant="inverse"
            arrow={false}
            className="h-14 w-14 shrink-0 px-0"
            icon={<IconReload className="size-[26px]" strokeWidth={2.75} />}
            onClick={() => router.push("/create")}
            aria-label="Ещё раз"
            title="Ещё раз"
          />
          <Button
            type="button"
            variant="inverse"
            look="display"
            arrow={false}
            className="h-14 min-w-0 flex-1"
            icon={<IconBrandInstagram className="size-5" strokeWidth={2.5} />}
            onClick={share}
            disabled={!cards.length}
            aria-busy={busy === "share" || undefined}
          >
            Поделиться
          </Button>
        </div>
        {/* «Скачать все» и «Ссылка» делят ряд 1,25 : 1 */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            look="display"
            arrow={false}
            className={cx(tool, "flex-[1.25]")}
            icon={ico(flash === "savedAll", IconDownload)}
            onClick={saveAll}
            disabled={!cards.length || busy !== null}
            aria-busy={busy === "saveAll" || undefined}
          >
            {busy === "saveAll" ? "Качаем…" : "Скачать все"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            look="display"
            arrow={false}
            className={cx(tool, "flex-1")}
            icon={ico(flash === "copied", IconLink)}
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
