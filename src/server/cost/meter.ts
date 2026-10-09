import { z } from "zod";
import { APIFY_PRICE, PRICES_CHECKED_AT, priceForModel } from "./prices";

/** Кто вызвал модель. Один шаг конвейера может звать несколько ролей. */
export const LlmRole = z.enum(["analyze", "writer", "judge", "moderator"]);
export type LlmRole = z.infer<typeof LlmRole>;

const count = z.number().int().nonnegative();

/** Сводка по паре (роль, модель): все вызовы, включая неудачные и ретраи. */
export const LlmCostLine = z.object({
  role: LlmRole,
  model: z.string().min(1),
  /** Все обращения к модели (успешные и неудачные). */
  calls: count,
  /** Из них закончились ошибкой (сеть, ответ не по схеме, обрезка). Токены таких вызовов тоже тут. */
  failedCalls: count,
  /** Входные токены без кэша. */
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  /** Стоимость строки в микродолларах (1e-6 USD), округлена один раз на строку. */
  microUsd: count,
});
export type LlmCostLine = z.infer<typeof LlmCostLine>;

export const ApifyCostLine = z.object({
  actor: z.string(),
  /** Обращения к Apify (первая попытка и ретрай). */
  attempts: count,
  /** Полученные элементы датасета (то, за что платим). */
  results: count,
  microUsd: count,
  /** `estimate` — результаты × тариф из конфига; `actual` зарезервировано под `usageTotalUsd`. */
  source: z.enum(["estimate", "actual"]),
});
export type ApifyCostLine = z.infer<typeof ApifyCostLine>;

/** Стоимость одного прогона шага (или проверки профиля). Тексты и данные профиля сюда не попадают. */
export const CostRun = z.object({
  llm: z.array(LlmCostLine),
  apify: ApifyCostLine.nullable(),
  /** Итог прогона, микро-USD (сумма строк). Центы считаются из суммы, а не из строк. */
  microUsd: count,
  /**
   * `true`, если хоть одна цена не сверена (`verified: false`) или модель неизвестна (см. `prices.ts`).
   * Оценочность суммы Apify (результаты × тариф) сюда не входит: она в `apify.source`.
   */
  estimated: z.boolean(),
  /** Дата сверки таблицы цен, по которой считали. */
  pricesAsOf: z.string(),
});
export type CostRun = z.infer<typeof CostRun>;

/** Токены вызова в виде, который отдаёт AI SDK (`LanguageModelUsage`); всё необязательно. */
export type SdkUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?:
    | {
        noCacheTokens?: number | undefined;
        cacheReadTokens?: number | undefined;
        cacheWriteTokens?: number | undefined;
      }
    | undefined;
};

const safeInt = (n: number | undefined): number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;

/** Микро-USD → целые центы, вверх. Округление только здесь и только на итоге. */
export function microUsdToCents(microUsd: number): number {
  return Math.ceil(microUsd / 10_000);
}

type Acc = {
  role: LlmRole;
  model: string;
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/**
 * Счётчик трат одного прогона (проверки профиля или шага генерации). Пассивный: только копит
 * числа, ничего не бросает и не меняет поведение вызовов. Цена применяется в `snapshot()`:
 * токены суммируются точно, деньги округляются один раз на строку.
 */
export class CostMeter {
  private readonly lines = new Map<string, Acc>();
  private apify: { attempts: number; results: number } | null = null;

  /** Один вызов модели. `usage` нет (сбой сети, таймаут): считаем попытку без токенов. */
  recordLlm(input: {
    role: LlmRole;
    model: string;
    usage?: SdkUsage | undefined;
    ok: boolean;
  }): void {
    const key = `${input.role}\u0000${input.model}`;
    let acc = this.lines.get(key);
    if (!acc) {
      acc = {
        role: input.role,
        model: input.model,
        calls: 0,
        failedCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      this.lines.set(key, acc);
    }
    acc.calls++;
    if (!input.ok) acc.failedCalls++;
    const u = input.usage;
    if (!u) return;
    const read = safeInt(u.inputTokenDetails?.cacheReadTokens);
    const write = safeInt(u.inputTokenDetails?.cacheWriteTokens);
    const noCacheReported = u.inputTokenDetails?.noCacheTokens;
    const noCache =
      noCacheReported !== undefined
        ? safeInt(noCacheReported)
        : Math.max(0, safeInt(u.inputTokens) - read - write);
    acc.inputTokens += noCache;
    acc.cacheReadTokens += read;
    acc.cacheWriteTokens += write;
    acc.outputTokens += safeInt(u.outputTokens);
  }

  /** Одно обращение к Apify: `results` — элементов в ответе (0 при сбое). */
  recordApify(input: { results: number }): void {
    this.apify ??= { attempts: 0, results: 0 };
    this.apify.attempts++;
    this.apify.results += safeInt(input.results);
  }

  snapshot(): CostRun {
    let estimated = false;
    const llm: LlmCostLine[] = [];
    for (const a of this.lines.values()) {
      const { price, known } = priceForModel(a.model);
      if (!known || !price.verified) estimated = true;
      const usd =
        (a.inputTokens * price.inputUsdPerMTok +
          a.outputTokens * price.outputUsdPerMTok +
          a.cacheReadTokens * price.cacheReadUsdPerMTok +
          a.cacheWriteTokens * price.cacheWriteUsdPerMTok) /
        1_000_000;
      llm.push({ ...a, microUsd: Math.round(usd * 1_000_000) });
    }
    let apify: ApifyCostLine | null = null;
    if (this.apify) {
      if (!APIFY_PRICE.verified) estimated = true;
      apify = {
        actor: APIFY_PRICE.actor,
        attempts: this.apify.attempts,
        results: this.apify.results,
        microUsd: Math.round(this.apify.results * APIFY_PRICE.usdPerResult * 1_000_000),
        source: "estimate",
      };
    }
    const microUsd = llm.reduce((s, l) => s + l.microUsd, 0) + (apify?.microUsd ?? 0);
    return { llm, apify, microUsd, estimated, pricesAsOf: PRICES_CHECKED_AT };
  }
}

/**
 * Одна строка лога на шаг: только числа, без текстов и ников. Центы — для чтения глазами;
 * в БД центы считаются из суммы микро-USD.
 */
export function formatCostLog(scope: string, run: CostRun): string {
  const sum = (pick: (l: LlmCostLine) => number) => run.llm.reduce((s, l) => s + pick(l), 0);
  const calls = run.llm.map((l) => `${l.role}:${l.calls}/${l.failedCalls}`).join(",");
  const apify = run.apify ? `${run.apify.attempts}/${run.apify.results}` : "0/0";
  return (
    `[cost] ${scope} вход=${sum((l) => l.inputTokens)} выход=${sum((l) => l.outputTokens)} ` +
    `кэш_чтение=${sum((l) => l.cacheReadTokens)} кэш_запись=${sum((l) => l.cacheWriteTokens)} ` +
    `вызовы_неудачные=${calls || "-"} apify_попытки_результаты=${apify} ` +
    `микро_usd=${run.microUsd} центов=${microUsdToCents(run.microUsd)}${run.estimated ? " оценка" : ""}`
  );
}
