"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { Quote } from "@/contracts";
import { Button } from "@/components/ui/Button";
import { LinkInput } from "@/components/ui/LinkInput";
import { Spinner } from "@/components/ui/Spinner";
import { api, toErrorCode } from "@/lib/client/api";
import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import { rememberLevel } from "@/lib/client/generation-meta";
import { formatRub } from "@/lib/client/money";
import { Blaze } from "../Blaze";
import { ERROR_TEXT, errorLine } from "../errors";
import { IconSquareRoundedCheck, IconX } from "../icons";
import { LEVEL_NAME, TIER_NAME } from "../labels";
import { StepTitle } from "../StepTitle";
import type { CreateStep } from "../steps";

function Row({
  label,
  children,
  onClick,
  big,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  big?: boolean;
}) {
  const inner = (
    <>
      <span className={big ? "text-paper" : "text-paper/70"}>{label}</span>
      <span className="text-right">{children}</span>
    </>
  );
  const cls = big
    ? "mt-1.5 flex items-center justify-between border-t-2 border-dashed border-paper/25 pt-3 font-wide text-lg leading-none font-extrabold text-paper"
    : "flex items-center justify-between py-1.5 type-body font-semibold text-paper";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} w-full text-left`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/**
 * Шаг 5. Горящий аватар, сводка (каждая строка возвращает на свой шаг), «волшебное слово»,
 * кнопка с ценой внизу. Цену считает сервер (/api/quotes); при 0 ₽ кнопка «Прожарить бесплатно»
 * и нажатие сразу запускает генерацию. Билинга нет: итог > 0 → «Оплата скоро. Есть волшебное слово?».
 */
export function CheckoutStep({
  draft,
  go,
}: {
  draft: CreateDraft;
  go: (step: CreateStep) => void;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [promoOpen, setPromoOpen] = useState(Boolean(draft.promoCode));
  const [promo, setPromo] = useState(draft.promoCode ?? "");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { tier, level, profile, profileCheckId } = draft;

  // Цена без слова при входе; с сохранённым словом — сразу с ним
  useEffect(() => {
    if (tier === undefined) return;
    let alive = true;
    api
      .createQuote({ tier, promoCode: draft.promoCode })
      .then((q) => alive && setQuote(q))
      .catch((e: unknown) => alive && setError(errorLine(toErrorCode(e))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт по слову идёт через applyPromo
  }, [tier]);

  async function applyPromo() {
    if (tier === undefined) return;
    const code = promo.trim();
    if (!code) return;
    setCheckingPromo(true);
    setPromoError(null);
    try {
      const q = await api.createQuote({ tier, promoCode: code });
      setQuote(q);
      patchDraft({ promoCode: code });
    } catch (e) {
      setPromoError(errorLine(toErrorCode(e)));
    } finally {
      setCheckingPromo(false);
    }
  }

  /** Крестик на зелёной плашке: снимаем слово и пересчитываем цену без него. */
  async function removePromo() {
    if (tier === undefined) return;
    setPromo("");
    setPromoError(null);
    patchDraft({ promoCode: undefined });
    try {
      setQuote(await api.createQuote({ tier }));
    } catch (e) {
      setError(errorLine(toErrorCode(e)));
    }
  }

  async function start() {
    if (!profileCheckId || tier === undefined || level === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createGeneration({
        profileCheckId,
        mode: draft.mode,
        kind: "roast_v1",
        tier,
        level,
        ageConfirmed: level === "well_done" ? draft.ageConfirmed : undefined,
        extraFacts: draft.extraFacts.length ? draft.extraFacts : undefined,
        promoCode: draft.promoCode,
      });
      rememberLevel(id, level);
      router.push(`/g/${id}`);
    } catch (e) {
      const code = toErrorCode(e);
      setError(errorLine(code));
      if (code === "payment_required" || code === "promo_invalid") setPromoOpen(true);
      setBusy(false);
    }
  }

  const free = quote !== null && quote.finalAmount === 0;
  const cta = quote
    ? free
      ? "Прожарить бесплатно"
      : `Прожарить за ${formatRub(quote.finalAmount)}`
    : "Прожарить";

  return (
    <>
      <StepTitle accent="к жарке" split>
        Всё готово
      </StepTitle>
      {profile && <Blaze username={profile.username} />}

      <div className="mt-[50px] rounded-md border-2 border-white bg-ink px-4 py-2">
        {tier !== undefined && (
          <Row label="Тариф" onClick={() => go("tier")}>
            {TIER_NAME[tier]}
          </Row>
        )}
        {level !== undefined && (
          <Row label="Прожарка" onClick={() => go("level")}>
            {LEVEL_NAME[level]}
          </Row>
        )}
        <Row label="Фактов" onClick={() => go("facts")}>
          {draft.extraFacts.length}
        </Row>
        {quote?.promo && (
          <>
            <Row label="Цена">
              <s className="text-paper/50">{formatRub(quote.listAmount)}</s>
            </Row>
            <Row label={`Слово ${quote.promo.code}`}>−{quote.promo.percentOff}%</Row>
          </>
        )}
        {quote?.freeTrial && <Row label="Первый раз">Бесплатно</Row>}
        <Row label="К оплате" big>
          {quote ? formatRub(quote.finalAmount) : "…"}
        </Row>
      </div>

      {quote?.promo ? (
        // Слово применилось: зелёная плашка вместо поля, галочка подтверждает скидку
        <div className="mt-3 flex h-16 items-center gap-3 rounded-md bg-acid pr-3 pl-5 text-ink">
          <IconSquareRoundedCheck
            className="size-6 shrink-0"
            strokeWidth={2.5}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-lg font-bold">{quote.promo.code}</span>
          <button
            type="button"
            onClick={() => void removePromo()}
            aria-label="Убрать волшебное слово"
            className="flex size-10 shrink-0 items-center justify-center rounded-sm text-ink/45 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            <IconX className="size-4" strokeWidth={2.5} />
          </button>
        </div>
      ) : promoOpen ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void applyPromo();
          }}
        >
          <LinkInput
            before={null}
            tall
            name="promo"
            placeholder="Волшебное слово"
            autoCapitalize="characters"
            value={promo}
            disabled={checkingPromo}
            onChange={(e) => {
              setPromo(e.target.value);
              setPromoError(null);
            }}
            error={promoError ?? undefined}
          />
          {!quote?.promo && (
            <Button
              type="submit"
              variant="ghost"
              className="h-11 w-full"
              arrow={false}
              disabled={!promo.trim() || checkingPromo}
            >
              {checkingPromo ? (
                <>
                  <Spinner />
                  Проверяем…
                </>
              ) : (
                "Применить"
              )}
            </Button>
          )}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setPromoOpen(true)}
          className="mx-auto mt-3 type-label text-paper underline underline-offset-4"
        >
          Есть волшебное слово?
        </button>
      )}

      <div className="mt-auto flex flex-col gap-3 pt-4">
        {error && <p className="border-l-2 border-red pl-3 type-body text-paper">{error}</p>}
        <Button
          type="button"
          variant="inverse"
          look="display"
          arrow={false}
          className="h-16 w-full"
          onClick={start}
          disabled={busy || !quote}
          aria-busy={busy || undefined}
        >
          {busy ? (
            <>
              <Spinner />
              Разжигаем…
            </>
          ) : (
            cta
          )}
        </Button>
      </div>
    </>
  );
}

// Текст «Оплата скоро» приходит из общего словаря ошибок
void ERROR_TEXT;
