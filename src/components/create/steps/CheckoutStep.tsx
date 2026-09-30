"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, toErrorCode } from "@/lib/client/api";
import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import { Placeholder, WorkInProgress } from "./Placeholder";
import type { CreateStep } from "../steps";

export function CheckoutStep({ draft }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!draft.profileCheckId || draft.tier === undefined || draft.level === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const promoCode = "ПОГНАЛИ100";
      patchDraft({ promoCode });
      const { id } = await api.createGeneration({
        profileCheckId: draft.profileCheckId,
        mode: draft.mode,
        kind: "roast_v1",
        tier: draft.tier,
        level: draft.level,
        ageConfirmed: draft.ageConfirmed || undefined,
        extraFacts: draft.extraFacts.length ? draft.extraFacts : undefined,
        promoCode,
      });
      // Черновик сбрасывает страница генерации: если сбросить здесь, CreateFlow
      // успеет откатить шаг на «профиль» раньше, чем сработает переход.
      router.push(`/g/${id}`);
    } catch (e) {
      setError(`Ошибка: ${toErrorCode(e)}`);
      setBusy(false);
    }
  }

  return (
    <Placeholder
      title="Всё готово"
      accent="к жарке"
      action="Прожарить бесплатно (слово ПОГНАЛИ100, мок)"
      onNext={start}
      busy={busy}
    >
      <WorkInProgress branch="fe/p1-checkout" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-body text-paper/70">
        <dt>Профиль</dt>
        <dd className="text-paper">@{draft.profile?.username}</dd>
        <dt>Тариф</dt>
        <dd className="text-paper">{draft.tier}</dd>
        <dt>Прожарка</dt>
        <dd className="text-paper">{draft.level}</dd>
      </dl>
      {error && <p className="type-body text-red">{error}</p>}
    </Placeholder>
  );
}
