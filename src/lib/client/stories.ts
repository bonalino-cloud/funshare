/**
 * «Поделиться» = в Instagram Stories (plans/phase-2: репост в сторис обязателен для MVP).
 * Прямого входа в Stories у сайта нет: `instagram-stories://` и интент ADD_TO_STORY
 * работают только из нативного приложения с Facebook App ID. Поэтому отдаём системному
 * меню одну PNG 9:16 без текста и ссылки — тогда Instagram в меню есть и сразу
 * предлагает «История». Ссылку кладём в буфер: её вставляют стикером «Ссылка».
 */
export type StoryShareResult = "shared" | "saved" | "cancelled";

export async function shareToStories(
  file: File,
  link: string,
  /** Нет системного меню с файлами (десктоп, старые браузеры): сохраняем PNG. */
  save: (file: File) => void,
): Promise<StoryShareResult> {
  // Не ждём буфер: на iOS любое долгое ожидание до share() съедает жест, и меню не откроется
  navigator.clipboard?.writeText(link).catch(() => undefined);
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  save(file);
  return "saved";
}

/** Подсказка после шеринга: итог человеческими словами. */
export const STORY_HINT: Record<Exclude<StoryShareResult, "cancelled">, string> = {
  shared: "Ссылка скопирована: вставь её в сторис стикером «Ссылка»",
  saved: "Картинка сохранена. Открой Instagram → История и выбери её",
};
