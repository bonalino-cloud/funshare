"use client";

import { useEffect, useRef, useState } from "react";
import type { ErrorCode, GenerationMode } from "@/contracts";
import { Button } from "@/components/ui/Button";
import { LinkInput } from "@/components/ui/LinkInput";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import extinguisher from "@/components/roast/assets/sticker-extinguisher.png";
import { api, toErrorCode } from "@/lib/client/api";
import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import { checkInstagramInput } from "@/lib/client/instagram";
import { pollUntil } from "@/lib/client/poll";
import { ArtStage } from "../ArtStage";
import impInspect from "../assets/imp-inspect.png";
import { errorLine, inputHint } from "../errors";
import { ProfileFound } from "../ProfileFound";
import { QuietLink } from "../QuietLink";
import { StepLead, StepTitle } from "../StepTitle";
import type { CreateStep } from "../steps";

const MODES: ReadonlyArray<{ value: GenerationMode; label: string }> = [
  { value: "self", label: "Себя" },
  { value: "friend", label: "Друга" },
];

/** Пока сервер не прислал свою строку, крутим свои каждые 3 с */
const CHECKING_LINES = ["Открываем профиль…", "Листаем ленту…", "Смотрим, можно ли жарить…"];

type Phase =
  { kind: "idle" } | { kind: "checking"; hint?: string } | { kind: "error"; code: ErrorCode };

/**
 * Шаг 1. Проверка профиля идёт до оплаты: открыт, постов хватает, владельцу есть 16.
 * Успех сохраняется в черновик, экран сменяется на «Нашли!», дальше кнопка «Дальше».
 */
export function ProfileStep({ draft, go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  const [value, setValue] = useState(draft.instagramUrl);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [tick, setTick] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const [settled, setSettled] = useState(value);

  const input = checkInstagramInput(value);
  const username = input.ok ? input.username : null;
  const checking = phase.kind === "checking";

  // Подсказку показываем, когда человек перестал печатать: не мигаем на «https://ins…»
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), 500);
    return () => clearTimeout(t);
  }, [value]);
  const liveHint = settled === value && !input.ok ? inputHint(input.issue) : undefined;

  // Локальные строки ожидания, если бэк не прислал hint
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, [checking]);

  useEffect(() => () => abort.current?.abort(), []);

  async function check() {
    if (!username) {
      setPhase({ kind: "error", code: "invalid_url" });
      return;
    }
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: "checking" });
    try {
      const { id } = await api.createProfileCheck({ instagramUrl: value });
      const result = await pollUntil(
        () => api.getProfileCheck(id),
        (s) => s.status !== "checking",
        {
          signal: ac.signal,
          onTick: (s) => setPhase({ kind: "checking", hint: s.hint }),
        },
      );
      if (result.status === "ok" && result.profile) {
        patchDraft({ instagramUrl: value, profileCheckId: id, profile: result.profile });
        setPhase({ kind: "idle" });
      } else {
        setPhase({ kind: "error", code: result.errorCode ?? "internal" });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setPhase({ kind: "error", code: toErrorCode(e) });
    }
  }

  if (draft.profile) {
    return (
      <>
        <ProfileFound profile={draft.profile} />
        <div className="mt-auto flex flex-col pt-4">
          <Button
            type="button"
            variant="inverse"
            look="display"
            arrow={false}
            className="h-16 w-full"
            onClick={() => go("facts")}
          >
            Дальше
          </Button>
        </div>
        <div className="flex flex-col pt-1">
          <QuietLink onClick={() => patchDraft({ profileCheckId: undefined, profile: undefined })}>
            Другой профиль
          </QuietLink>
        </div>
      </>
    );
  }

  const statusLine =
    phase.kind === "checking"
      ? (phase.hint ?? CHECKING_LINES[tick % CHECKING_LINES.length])
      : undefined;

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (!checking) void check();
      }}
    >
      <StepTitle accent="жарим?">Кого</StepTitle>
      <StepLead>
        {checking
          ? "Смотрим, можно ли жарить: открыт, постов хватает, есть 16"
          : "Кидай ссылку на открытый Instagram"}
      </StepLead>

      {phase.kind === "error" ? (
        <ArtStage src={extinguisher} size="md" wiggle />
      ) : (
        <ArtStage src={impInspect} scan={checking} />
      )}

      <div className="mt-auto mb-5 flex flex-col gap-4 pt-4">
        <Segmented
          label="Кого жарим"
          value={draft.mode}
          options={MODES}
          onChange={(mode) => patchDraft({ mode })}
          disabled={checking}
        />
        <LinkInput
          name="instagram"
          tall
          placeholder="username"
          value={value}
          disabled={checking}
          onChange={(e) => {
            setValue(e.target.value);
            if (phase.kind === "error") setPhase({ kind: "idle" });
          }}
          error={
            phase.kind === "error"
              ? phase.code === "invalid_url" && liveHint
                ? liveHint
                : errorLine(phase.code)
              : liveHint
          }
        />
        {checking ? (
          <Button
            type="button"
            variant="inverse"
            look="display"
            arrow={false}
            className="h-16 w-full"
            aria-busy
          >
            <Spinner />
            {statusLine}
          </Button>
        ) : (
          <Button
            type="submit"
            variant="inverse"
            look="display"
            arrow={false}
            className="h-16 w-full"
            disabled={!username}
          >
            {phase.kind === "error" ? "Проверить ещё раз" : "Проверить"}
          </Button>
        )}
        <QuietLink href="/roast">На главную</QuietLink>
      </div>
    </form>
  );
}
