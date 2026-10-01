import type { Metadata } from "next";
import Image from "next/image";
import { Marquee } from "@/components/brand/Marquee";
import { RoastHero } from "@/components/roast/RoastHero";
import { StickyCta } from "@/components/roast/StickyCta";
import { DegreesSection } from "@/components/roast/sections/DegreesSection";
import { FaqSection } from "@/components/roast/sections/FaqSection";
import { FinalCta } from "@/components/roast/sections/FinalCta";
import { LevelsSection } from "@/components/roast/sections/LevelsSection";
import { RoastFooter } from "@/components/roast/sections/RoastFooter";
import { RulesSection } from "@/components/roast/sections/RulesSection";
import { StepsSection } from "@/components/roast/sections/StepsSection";
import { VideoSection } from "@/components/roast/sections/VideoSection";
import { WhenSection } from "@/components/roast/sections/WhenSection";
import chili from "@/components/roast/assets/sticker-chili.png";
import match from "@/components/roast/assets/sticker-match.png";
import flame from "@/components/roast/assets/sticker-flame.png";
import pan from "@/components/roast/assets/sticker-pan.png";

export const metadata: Metadata = {
  title: "Прожарка — Funshare",
  description:
    "Кидаешь профиль на открытый огонь. Получаешь прожаренный горячий результат, который не оставит равнодушным.",
};

const sticker = (src: typeof chili) => (
  <Image src={src} alt="" className="h-10 w-auto md:h-16" sizes="96px" />
);

/**
 * Мини-лендинг «Прожарка». Этажи чередуются по DESIGN.md §9.1:
 * dark (hero) → light → color → light (степени) → dark → лента → light → color → dark → color (CTA) → footer в огне.
 */
export default function RoastPage() {
  return (
    <main className="flex flex-1 flex-col overflow-x-clip">
      <RoastHero />
      <LevelsSection />
      <VideoSection />
      <DegreesSection />
      <StepsSection />
      <div className="relative z-10 -my-8 bg-transparent py-4">
        <Marquee
          tone="acid"
          tilt={-2}
          size="lg"
          className="border-y-2 border-ink"
          items={[
            "Прожарка",
            sticker(chili),
            "Огнеопасно",
            sticker(match),
            "Бесплатно",
            sticker(flame),
            "Ответка",
            sticker(pan),
          ]}
        />
      </div>
      <WhenSection />
      <RulesSection />
      <FaqSection />
      <FinalCta />
      <RoastFooter />
      <StickyCta />
    </main>
  );
}
