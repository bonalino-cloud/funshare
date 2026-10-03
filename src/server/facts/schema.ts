import { z } from "zod";
import { BIO_CAP, CAPTION_CAP, codepointLength } from "./text";

// BE-only тип (НЕ контракт FE<->BE): результат детерминированной части `analyze`
// (roast-engine.md §3). Строится из ProfileSnapshot, потом уходит в LLM-часть analyze.
// Здесь нет imageUrl, username, fullName, externalUrl: только то, что нужно досье.

/** Лимиты размеров выходных массивов. */
export const LIMITS = {
  hashtags: 10,
  locations: 5,
  words: 20,
  captionsForLlm: 24,
  /** Порог «слово встречается чаще 4 раз» => минимум 5 вхождений. */
  wordMinCount: 5,
  /** Хэштег/локация попадают в «повторы», только если встретились минимум в 2 постах. */
  repeatMinCount: 2,
} as const;

const Share = z.number().min(0).max(1);
const Count = z.number().int().nonnegative();
const CappedText = (cap: number) =>
  z.string().refine((s) => codepointLength(s) <= cap, `не длиннее ${cap} символов`);
const NoControl = (s: string) => !/[\p{Cc}\p{Cf}]/u.test(s.replace(/\u{200d}/gu, ""));
const CleanText = (cap: number) =>
  CappedText(cap)
    .refine(NoControl, "без управляющих символов")
    .refine((s) => !/[<>]/.test(s), "без угловых скобок (граница <profile_data>)");

export const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof Weekday>;

const PostRef = z.object({
  /** Индекс в ProfileSnapshot.posts. */
  index: Count,
  takenAt: z.iso.datetime(),
  likes: Count,
  /** Очищенная подпись с кэпом; пустая, если в подписи была PII или её нет. */
  caption: CleanText(CAPTION_CAP),
});

export const ProfileFacts = z.object({
  postsAnalyzed: Count,

  stats: z.object({
    /** Постов в неделю: (n-1) интервалов / окно между первым и последним постом. null: <2 постов или окно <1 дня. */
    postsPerWeek: z.number().nonnegative().nullable(),
    videoShare: Share.nullable(),
    carouselShare: Share.nullable(),
    /** UTC: часовой пояс профиля в данных скрейпа отсутствует. */
    topHourUtc: z.number().int().min(0).max(23).nullable(),
    topWeekdayUtc: Weekday.nullable(),
    /** Среднее только по постам с известными лайками; null, если лайки скрыты везде. */
    avgLikes: z.number().nonnegative().nullable(),
    noCaptionShare: Share.nullable(),
  }),

  repeats: z.object({
    hashtags: z.array(z.object({ tag: CleanText(60), count: Count })).max(LIMITS.hashtags),
    locations: z.array(z.object({ name: CleanText(100), count: Count })).max(LIMITS.locations),
    words: z.array(z.object({ word: CleanText(40), count: Count })).max(LIMITS.words),
  }),

  rhythm: z.object({
    longestGapDays: z.number().nonnegative().nullable(),
    /** Дней (UTC) с 3+ постами. */
    burstDays: Count,
    hasBurst: z.boolean(),
    maxPostsInDay: Count,
    /** Дней от последнего поста до `now` (по умолчанию fetchedAt). */
    daysSinceLastPost: z.number().nonnegative().nullable(),
    topPost: PostRef.nullable(),
    worstPost: PostRef.nullable(),
  }),

  language: z.object({
    /** ISO 639-1 для PersonaProfile.language; null, если букв нет/поровну (решает analyze). */
    code: z.string().length(2).nullable(),
    /** Эмодзи / (эмодзи + буквы) в очищенных подписях. */
    emojiShare: Share.nullable(),
    /** Доля постов, где есть хотя бы одно эмодзи. */
    emojiPostShare: Share.nullable(),
  }),

  pii: z.object({
    /** Сколько подписей отброшено от LLM из-за PII. */
    captionsWithPii: Count,
    biographyHadPii: z.boolean(),
  }),

  /** Био без PII и управляющих символов, с кэпом. В LLM только внутри <profile_data>. */
  biography: CleanText(BIO_CAP),
  /** Подписи без PII, с кэпом 300. */
  captionsForLlm: z
    .array(
      z.object({
        index: Count,
        takenAt: z.iso.datetime(),
        caption: CleanText(CAPTION_CAP).refine((s) => s.length > 0),
      }),
    )
    .max(LIMITS.captionsForLlm),
});
export type ProfileFacts = z.infer<typeof ProfileFacts>;
