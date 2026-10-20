import type { CheckedProfile, ErrorCode, ProfileSnapshot } from "@/contracts";
import { CostMeter, formatCostLog } from "../cost";
import type { EnsureDossier } from "../dossier";
import { capCodepoints, cleanUntrusted } from "../facts/text";
import type { ScrapeResult } from "../scrape";
import type { CopyAvatar, RemoveAvatar } from "./avatar";
import { HINTS, PIPELINE_DEADLINE_MS, TOTAL_DEADLINE_MS } from "./config";
import { discardMinorAvatar } from "./minor";
import type { ProfileCheckRepository } from "./repository";

export type PipelineDeps = {
  /** Копия аватара в наш Blob: URL Instagram браузер не покажет (CORP same-origin). Не бросает. */
  copyAvatar: CopyAvatar;
  /** `meter` — счётчик трат этой проверки; шаг передаёт его в Apify-вызовы. */
  scrape: (username: string, meter: CostMeter) => Promise<ScrapeResult>;
  /** Досье в фоне после «Нашли!» (`waitMs = 0`: если его уже считают, не ждём). Не бросает. */
  ensureDossier: EnsureDossier;
  /** Удалить копию аватара из публичного Blob (досье показало «младше 16»). */
  removeAvatar: RemoveAvatar;
  repo: ProfileCheckRepository;
  now: () => Date;
  /** Потолок самой проверки (скрейп + аватар). */
  deadlineMs?: number;
  /** Потолок всей фоновой работы, включая досье: отсчёт от старта фона. */
  totalDeadlineMs?: number;
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
  | { ok: true; snapshotId: string; snapshot: ProfileSnapshot; profile: CheckedProfile }
  | { ok: false; errorCode: ErrorCode };

/**
 * Фон проверки: scrape (внутри правила без модели: не найден, закрыт, мало данных) → копия аватара
 * → `ok` («Нашли!»). Модели в проверке нет: траты — только Apify. Потом, уже после записи `ok`,
 * в той же фоновой работе считается досье (`ensureDossier`), отдельной строкой `[cost]`.
 * Ничего не бросает: любое падение и превышение дедлайна закрывают проверку как `failed/internal`,
 * а не оставляют вечный `checking`. Отказ scrape закрывает проверку, досье тогда не считается
 * (инвариант 11). «Младше 16» определяется досье и проверяется перед заказом (`/api/generations`);
 * если оно сработало здесь, аватар из публичного Blob удаляется.
 * Если и запись в БД упала — проверку закроет GET по `STALE_AFTER_MS`.
 */
export async function runProfileCheck(
  id: string,
  username: string,
  deps: PipelineDeps,
): Promise<void> {
  const { repo } = deps;
  const startedAt = Date.now();
  const meter = new CostMeter();

  const setHint = async (hint: string) => {
    try {
      await repo.setHint(id, hint);
    } catch (error) {
      logFailure("не записали hint", error); // не критично: лоудер просто не сменит строку
    }
  };

  const work = async (): Promise<Outcome> => {
    await setHint(HINTS.scrape);
    const scraped = await deps.scrape(username, meter);
    if (!scraped.ok) return { ok: false, errorCode: scraped.errorCode };

    // Аватар копируем только после правил: фото закрытого профиля не храним. Если потом досье
    // скажет «младше 16», копия удаляется (см. `discardMinorAvatar`).
    let avatarUrl: string | null = null;
    try {
      avatarUrl = await deps.copyAvatar({ username, url: scraped.snapshot.avatarUrl });
    } catch (error) {
      logFailure("аватар не скопирован", error); // копировщик не бросает, но проверка не должна падать
    }
    return {
      ok: true,
      snapshotId: scraped.snapshotId,
      snapshot: scraped.snapshot,
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
  let settled = false;
  const guarded = work()
    .catch((error: unknown): Outcome => {
      logFailure("сбой конвейера", error);
      return { ok: false, errorCode: "internal" };
    })
    .finally(() => {
      settled = true;
    });

  const outcome = await Promise.race([guarded, deadline]);
  clearTimeout(timer);

  // Деньги потрачены при любом исходе (и при отказе, и по дедлайну): пишем то, что уже накоплено.
  const cost = meter.snapshot();
  if (cost.apify) console.error(formatCostLog("profile-check", cost));
  if (!settled) {
    // Дедлайн: работа ещё идёт и тратит. В БД строка уже закрыта, полный итог — только в лог.
    void guarded.then(() =>
      console.error(formatCostLog("profile-check после дедлайна", meter.snapshot())),
    );
  }

  try {
    const checkedAt = deps.now();
    if (outcome.ok) {
      await repo.complete(id, {
        snapshotId: outcome.snapshotId,
        profile: outcome.profile,
        checkedAt,
        cost,
      });
    } else {
      await repo.fail(id, outcome.errorCode, checkedAt, cost);
    }
  } catch (error) {
    logFailure("не записали результат", error);
    return; // проверка закроется по STALE_AFTER_MS; досье без `ok` в БД никому не нужно
  }

  if (outcome.ok) await runDossier(id, username, outcome, deps, startedAt);
}

/**
 * Досье в фоне после «Нашли!». Укладываемся в общий потолок фона: не успели — бросаем ожидание, а
 * недосчитанное досье дорешает старт генерации (замок в `dossier_runs` не даст платить дважды).
 * «Младше 16» → убираем аватар из публичного Blob.
 */
async function runDossier(
  id: string,
  username: string,
  outcome: Extract<Outcome, { ok: true }>,
  deps: PipelineDeps,
  startedAt: number,
): Promise<void> {
  const remainingMs = (deps.totalDeadlineMs ?? TOTAL_DEADLINE_MS) - (Date.now() - startedAt);
  if (remainingMs <= 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), remainingMs);
  });
  try {
    const result = await Promise.race([
      deps.ensureDossier({ snapshotId: outcome.snapshotId, snapshot: outcome.snapshot }, 0),
      timeout,
    ]);
    if (result === "timeout") {
      logFailure("дедлайн фона: досье дорешает старт генерации");
    } else if (!result.ok && result.errorCode === "minor_detected") {
      await discardMinorAvatar(
        { removeAvatar: deps.removeAvatar, repo: deps.repo },
        username,
        outcome.profile.avatarUrl,
      );
    }
  } catch (error) {
    logFailure(`досье в фоне: проверка ${id} не дособрана`, error);
  } finally {
    clearTimeout(timer);
  }
}
