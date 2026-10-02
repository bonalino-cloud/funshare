import { permanentRedirect } from "next/navigation";

/** Лендинг «Прожарка» теперь главная страница. Старые ссылки на /roast ведём в корень (308). */
export default function RoastRedirect() {
  permanentRedirect("/");
}
