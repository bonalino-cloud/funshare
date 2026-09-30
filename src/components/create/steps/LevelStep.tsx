"use client";

import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import { Placeholder, WorkInProgress } from "./Placeholder";
import type { CreateStep } from "../steps";

export function LevelStep({ go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  return (
    <Placeholder
      title="Насколько"
      accent="жарко?"
      action="Medium (мок)"
      onNext={() => {
        patchDraft({ level: "medium", ageConfirmed: false });
        go("checkout");
      }}
    >
      <WorkInProgress branch="fe/p1-create-level" />
    </Placeholder>
  );
}
