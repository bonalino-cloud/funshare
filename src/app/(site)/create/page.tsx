import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateFlow } from "@/components/create/CreateFlow";

export const metadata: Metadata = {
  title: "Прожарка: создание — Funshare",
  robots: { index: false },
};

/** useSearchParams в CreateFlow требует границу Suspense при статическом рендере. */
export default function CreatePage() {
  return (
    <Suspense fallback={null}>
      <CreateFlow />
    </Suspense>
  );
}
