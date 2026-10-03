import type { Metadata } from "next";
import { ArtifactPage } from "@/components/artifact/ArtifactPage";

// OG-превью с карточкой появится, когда BE отдаст getArtifact(slug) на сервере
export const metadata: Metadata = {
  title: "Прожарка — Funshare",
  description: "Меня прожарил ИИ. Он прав",
  robots: { index: false },
};

export default async function ArtifactRoute(props: PageProps<"/a/[slug]">) {
  const { slug } = await props.params;
  return <ArtifactPage slug={slug} />;
}
