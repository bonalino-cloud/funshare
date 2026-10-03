import type { Metadata } from "next";
import { GenerationFlow } from "@/components/create/GenerationFlow";

export const metadata: Metadata = {
  title: "Жарим… — Funshare",
  robots: { index: false },
};

export default async function GenerationPage(props: PageProps<"/g/[id]">) {
  const { id } = await props.params;
  return <GenerationFlow id={id} />;
}
