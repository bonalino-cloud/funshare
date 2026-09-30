"use client";

import type { CreateDraft } from "@/lib/client/draft";
import { Placeholder, WorkInProgress } from "./Placeholder";
import type { CreateStep } from "../steps";

export function FactsStep({ go }: { draft: CreateDraft; go: (step: CreateStep) => void }) {
  return (
    <Placeholder
      title="Занимательные"
      accent="факты"
      lead="Чем больше пикантных фактов, тем точнее и смешнее получится прожарка"
      onNext={() => go("tier")}
    >
      <WorkInProgress branch="fe/p1-create-facts" />
    </Placeholder>
  );
}
