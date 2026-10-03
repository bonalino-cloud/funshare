import { fontVariables } from "@/styles/fonts";

// Шрифты вешаем на обёртку сайта, а не на корневой layout (он в зоне DAN).
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${fontVariables} flex flex-1 flex-col font-sans`}>{children}</div>;
}
