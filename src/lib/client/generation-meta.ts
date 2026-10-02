import { Level } from "@/contracts";

/**
 * Степень прожарки по id генерации: статус генерации её не отдаёт, а черновик на /g/[id]
 * уже очищен. Нужна лоудеру, чтобы показать ту же картинку, что человек выбрал на шаге 4.
 * localStorage может быть недоступен (приватный режим) — тогда просто ничего не помним.
 */
const KEY = (id: string) => `funshare:gen-level:${id}`;

export function rememberLevel(id: string, level: Level) {
  try {
    localStorage.setItem(KEY(id), level);
  } catch {
    // нет хранилища: лоудер покажет картинку по умолчанию
  }
}

export function recallLevel(id: string): Level | undefined {
  try {
    const parsed = Level.safeParse(localStorage.getItem(KEY(id)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
