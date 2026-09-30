"use client";

import { useState } from "react";
import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import { api, toErrorCode } from "@/lib/client/api";
import { pollUntil } from "@/lib/client/poll";
import { Placeholder, WorkInProgress } from "./Placeholder";
import type { CreateStep } from "../steps";

export function ProfileStep({ draft, go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setNote(null);
    try {
      const { id } = await api.createProfileCheck({ instagramUrl: "anya.travels" });
      const result = await pollUntil(
        () => api.getProfileCheck(id),
        (s) => s.status !== "checking",
        {
          intervalMs: 1000,
          onTick: (s) => setNote(s.hint ?? null),
        },
      );
      if (result.status === "ok" && result.profile) {
        patchDraft({ instagramUrl: "anya.travels", profileCheckId: id, profile: result.profile });
        go("facts");
      } else {
        setNote(`Ошибка: ${result.errorCode}`);
      }
    } catch (e) {
      setNote(`Ошибка: ${toErrorCode(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Placeholder
      title="Кого"
      accent="жарим?"
      lead="Кидай ссылку на открытый Instagram"
      action={busy ? (note ?? "Открываем профиль…") : "Проверить @anya.travels (мок)"}
      onNext={check}
      busy={busy}
    >
      <WorkInProgress branch="fe/p1-create-profile" />
      {draft.profile && (
        <p className="type-body text-paper/70">
          Уже проверен: @{draft.profile.username}, {draft.profile.postsCount} постов
        </p>
      )}
      {!busy && note && <p className="type-body text-red">{note}</p>}
    </Placeholder>
  );
}
