"use client";

import { useEffect, useRef, useState } from "react";
import type { ErrorCode, GenerationMode } from "@/contracts";
import { Button } from "@/components/ui/Button";
import { LinkInput } from "@/components/ui/LinkInput";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import extinguisher from "@/components/roast/assets/sticker-extinguisher.png";
import { track } from "@/lib/client/analytics";
import { api, isTransient, toErrorCode } from "@/lib/client/api";
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

type Phase =
  { kind: "idle" } | { kind: "starting"; startedAt: number } | { kind: "error"; code: ErrorCode };

/** `hint` от сервера по проверке `id`: первый увиденный и последний. */
type Hints = { id: string; first?: string; last?: string };

/**
 * Живая проверка идёт 30–70 с; после этого порога говорим, что осталось немного.
 * Строка короткая нарочно: в одну строку даже на телефоне шириной 320.
 */
const SLOW_AFTER_MS = 40_000;
const SLOW_LEAD = "Ещё немного…";
const FIRST_LEAD = "Идёт поиск…";

/**
 * Строка под заголовком, пока идёт проверка. Первый этап — «Идёт поиск…»; когда сервер переходит
 * к следующему этапу и присылает новый `hint`, показываем его («Смотрим, можно ли жарить…»).
 */
function checkingLead(hints: Hints | undefined, slow: boolean): string {
  if (slow) return SLOW_LEAD;
  if (hints?.last && hints.last !== hints.first) return hints.last;
  return FIRST_LEAD;
}

/**
 * Шаг 1. Проверка профиля идёт до оплаты: открыт, постов хватает, владельцу есть 16.
 * Запущенная проверка лежит в черновике (`pendingCheck`), поллинг идёт по ней: перезагрузка
 * или возврат на шаг продолжают ту же проверку, а не тратят лимит на новую.
 * Успех сохраняется в черновик, экран сменяется на «Нашли!», дальше кнопка «Дальше».
 */
export function ProfileStep({ draft, go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  const pending = draft.profile ? undefined : draft.pendingCheck;
  const [value, setValue] = useState(pending?.instagramUrl ?? draft.instagramUrl);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [hints, setHints] = useState<Hints>();
  const [slow, setSlow] = useState(false);

  const [settled, setSettled] = useState(value);
  const typed = useRef(false);

  const input = checkInstagramInput(value);
  const username = input.ok ? input.username : null;
  const checking = phase.kind === "starting" || pending !== undefined;
  const startedAt = pending?.startedAt ?? (phase.kind === "starting" ? phase.startedAt : null);

  // Подсказку показываем, когда человек перестал печатать: не мигаем на «https://ins…»
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), 500);
    return () => clearTimeout(t);
  }, [value]);
  const liveHint = settled === value && !input.ok ? inputHint(input.issue) : undefined;

  // Порог «долго» считаем от начала проверки, в том числе продолженной после перезагрузки
  useEffect(() => {
    if (startedAt === null) return;
    const t = setTimeout(() => setSlow(true), Math.max(0, startedAt + SLOW_AFTER_MS - Date.now()));
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [startedAt]);

  // Поллинг проверки из черновика: только что запущенной или продолженной; уход со шага — стоп
  useEffect(() => {
    if (!pending) return;
    const { id, instagramUrl } = pending;
    const ac = new AbortController();
    pollUntil(
      () => api.getProfileCheck(id),
      (s) => s.status !== "checking",
      {
        signal: ac.signal,
        // До ~10 с без связи (лифт, переключение в Instagram) не роняют проверку
        retries: 5,
        isRetryable: isTransient,
        onTick: (s) => {
          if (s.status !== "checking") return;
          setHints((h) =>
            h?.id === id ? { ...h, last: s.hint } : { id, first: s.hint, last: s.hint },
          );
        },
      },
    ).then(
      (result) => {
        if (result.status === "ok" && result.profile) {
          track("profile_checked", { result: "ok" });
          patchDraft({
            instagramUrl,
            pendingCheck: undefined,
            profileCheckId: id,
            profile: result.profile,
          });
        } else {
          const code = result.errorCode ?? "internal";
          track("profile_checked", { result: code });
          patchDraft({ pendingCheck: undefined });
          setPhase({ kind: "error", code });
        }
      },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        const code = toErrorCode(e);
        track("profile_checked", { result: code });
        patchDraft({ pendingCheck: undefined });
        setPhase({ kind: "error", code });
      },
    );
    return () => ac.abort();
  }, [pending]);

  async function check() {
    if (!username) {
      setPhase({ kind: "error", code: "invalid_url" });
      return;
    }
    const startedAt = Date.now();
    setPhase({ kind: "starting", startedAt });
    track("url_submitted", { mode: draft.mode });
    try {
      const { id } = await api.createProfileCheck({ instagramUrl: value });
      // Дальше проверку ведёт поллинг по черновику, в том числе если со шага уже ушли
      patchDraft({ pendingCheck: { id, instagramUrl: value, startedAt } });
      setPhase({ kind: "idle" });
    } catch (e) {
      const code = toErrorCode(e);
      track("profile_checked", { result: code });
      setPhase({ kind: "error", code });
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
          ? checkingLead(hints?.id === pending?.id ? hints : undefined, slow)
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
            if (!typed.current) {
              typed.current = true;
              track("input_start");
            }
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
            // Серая и неактивная, пока ищем: тот же вид, что у «Проверить» без ника
            disabled
            aria-busy
          >
            <Spinner />
            {/* Одно слово: смена статусов не влезала в строку кнопки и прыгала */}
            Ищем
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
        <QuietLink href="/">На главную</QuietLink>
      </div>
    </form>
  );
}
