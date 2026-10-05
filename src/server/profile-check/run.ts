import type { CheckedProfile, ErrorCode, ProfileSnapshot } from "@/contracts";
import type { AnalyzeStepResult } from "../analyze";
import { capCodepoints, cleanUntrusted } from "../facts/text";
import type { ScrapeResult } from "../scrape";
import type { CopyAvatar } from "./avatar";
import { HINTS, PIPELINE_DEADLINE_MS } from "./config";
import type { ProfileCheckRepository } from "./repository";

export type PipelineDeps = {
  /** Копия аватара в наш Blob: URL Instagram браузер не покажет (CORP same-origin). Не бросает. */
  copyAvatar: CopyAvatar;
  scrape: (username: string) => Promise<ScrapeResult>;
  analyze: (input: { snapshotId: string; snapshot: ProfileSnapshot }) => Promise<AnalyzeStepResult>;
  repo: ProfileCheckRepository;
  now: () => Date;
  deadlineMs?: number;
};

/** В лог — только тип события и имя ошибки: ни ника, ни текста профиля, ни ответа модели. */
function logFailure(event: string, detail?: unknown) {
  const name = detail instanceof Error ? detail.name : "";
  console.error(`[profile-check] ${event}${name ? `: ${name}` : ""}`);
}

/** Только http(s): в `<img src>` не должно попасть `javascript:` и прочие схемы из чужого профиля. */
export function safeAvatarUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Что уходит на экран «Нашли!»: без био, подписей и фактов, имя чистится как любой чужой текст.
 * `avatarUrl` — уже НАШ URL из Blob (или null): исходный URL Instagram сюда не попадает.
 */
export function toCheckedProfile(
  snapshot: ProfileSnapshot,
  avatarUrl: string | null,
): CheckedProfile {
  const name = capCodepoints(cleanUntrusted(snapshot.fullName).text.trim(), 100);
  return {
    username: snapshot.username,
    displayName: name === "" ? snapshot.username : name,
    avatarUrl: safeAvatarUrl(avatarUrl),
    postsCount: snapshot.postsCount,
  };
}

type Outcome =
  { ok: true; snapshotId: string; profile: CheckedProfile } | { ok: false; errorCode: ErrorCode };

/**
 * Фон проверки: scrape → analyze, по шагам обновляет `hint`, в конце пишет `ok` или `failed`.
 * Ничего не бросает: любое падение и превышение дедлайна закрывают проверку как `failed/internal`,
 * а не оставляют вечный `checking`. Гардрейлы (закрыт, мало данных, младше 16) — это
 * `failed` с кодом из шагов; платный analyze после отказа scrape не запускается (инвариант 11).
 * Если и запись в БД упала — проверку закроет GET по `STALE_AFTER_MS`.
 */
export async function runProfileCheck(
  id: string,
  username: string,
  deps: PipelineDeps,
): Promise<void> {
  const { repo } = deps;

  const setHint = async (hint: string) => {
    try {
      await repo.setHint(id, hint);
    } catch (error) {
      logFailure("не записали hint", error); // не критично: лоудер просто не сменит строку
    }
  };

  const work = async (): Promise<Outcome> => {
    await setHint(HINTS.scrape);
    const scraped = await deps.scrape(username);
    if (!scraped.ok) return { ok: false, errorCode: scraped.errorCode };

    await setHint(HINTS.analyze);
    const analyzed = await deps.analyze({
      snapshotId: scraped.snapshotId,
      snapshot: scraped.snapshot,
    });
    if (!analyzed.ok) return { ok: false, errorCode: analyzed.errorCode };

    // Аватар копируем только после успешного analyze: фото закрытого/несовершеннолетнего не храним.
    let avatarUrl: string | null = null;
    try {
      avatarUrl = await deps.copyAvatar({ username, url: scraped.snapshot.avatarUrl });
    } catch (error) {
      logFailure("аватар не скопирован", error); // копировщик не бросает, но проверка не должна падать
    }
    return {
      ok: true,
      snapshotId: scraped.snapshotId,
      profile: toCheckedProfile(scraped.snapshot, avatarUrl),
    };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => {
      logFailure("дедлайн фоновой работы");
      resolve({ ok: false, errorCode: "internal" });
    }, deps.deadlineMs ?? PIPELINE_DEADLINE_MS);
  });
  const guarded = work().catch((error: unknown): Outcome => {
    logFailure("сбой конвейера", error);
    return { ok: false, errorCode: "internal" };
  });

  const outcome = await Promise.race([guarded, deadline]);
  clearTimeout(timer);

  try {
    const checkedAt = deps.now();
    if (outcome.ok) {
      await repo.complete(id, {
        snapshotId: outcome.snapshotId,
        profile: outcome.profile,
        checkedAt,
      });
    } else {
      await repo.fail(id, outcome.errorCode, checkedAt);
    }
  } catch (error) {
    logFailure("не записали результат", error);
  }
}
