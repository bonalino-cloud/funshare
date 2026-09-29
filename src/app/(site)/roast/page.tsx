import type { Metadata } from "next";
import { RoastHero, type HeroSurface } from "@/components/roast/RoastHero";
import { ThemePicker } from "@/components/roast/ThemePicker";

export const metadata: Metadata = {
  title: "Прожарка — Funshare",
  description:
    "Кидай ссылку на Instagram. ИИ прочитает сторис и выдаст роаст, которым не стыдно поделиться.",
};

const surfaces: HeroSurface[] = ["dark", "light", "color"];

export default async function RoastPage({ searchParams }: PageProps<"/roast">) {
  const { theme } = await searchParams;
  const surface = surfaces.find((s) => s === theme) ?? "dark";

  return (
    <main className="flex flex-1 flex-col">
      <RoastHero surface={surface} />
      {/* Временно: выбор темы hero. Удалить, когда тема выбрана */}
      <ThemePicker current={surface} />
    </main>
  );
}
