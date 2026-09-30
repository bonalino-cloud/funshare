"use client";

import { patchDraft, type CreateDraft } from "@/lib/client/draft";
import { Placeholder, WorkInProgress } from "./Placeholder";
import type { CreateStep } from "../steps";

export function TierStep({ go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  return (
    <Placeholder
      title="Что"
      accent="получишь?"
      action="Кострище (мок)"
      onNext={() => {
        patchDraft({ tier: 2 });
        go("level");
      }}
    >
      <WorkInProgress branch="fe/p1-create-tier" />
    </Placeholder>
  );
}
