import type { ProfilePost, ProfileSnapshot } from "@/contracts/profile";
import { LIMITS, ProfileFacts, type Weekday } from "./schema";
import { STOPWORDS } from "./stopwords";
import {
  BIO_CAP,
  CAPTION_CAP,
  capCodepoints,
  cleanUntrusted,
  codepointLength,
  sanitizeText,
} from "./text";

// Детерминированная часть `analyze` (roast-engine.md §3). Без LLM, без сети, без Date.now():
// одинаковый вход даёт одинаковый выход. `now` по умолчанию равен snapshot.fetchedAt.

const DAY_MS = 86_400_000;
// getUTCDay(): 0 = воскресенье.
const WEEKDAYS: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const round = (x: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
};

/** «Леммы» упрощены: lowercase + ё->е. Полноценной лемматизации (падежи, формы) нет. */
const normalizeWord = (w: string): string => w.toLowerCase().replace(/ё/g, "е");

type Counted = { key: string; count: number };

/** Топ по убыванию счёта; равные счёты — по ключу (стабильно, без зависимости от локали). */
function topCounts(map: Map<string, number>, min: number, limit: number): Counted[] {
  return [...map.entries()]
    .filter(([, count]) => count >= min)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, limit);
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

const INLINE_HASHTAG = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]+)/gu;
const MENTION = /(?<![\p{L}\p{N}_])@[\p{L}\p{N}_.]+/gu;
const WORD = /\p{L}+(?:['’-]\p{L}+)*/gu;
const EMOJI_G = /\p{Extended_Pictographic}/gu;
const EMOJI_ONE = /\p{Extended_Pictographic}/u;
const LETTER = /\p{L}/gu;
const CYRILLIC = /\p{Script=Cyrillic}/gu;
const LATIN = /\p{Script=Latin}/gu;

/** Нормализует хэштег; null, если пусто, слишком длинно или в нём PII. */
function normalizeHashtag(raw: string): string | null {
  const { text, hadPii } = cleanUntrusted(raw.replace(/^#+/, ""));
  if (hadPii) return null;
  const tag = text.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
  return tag.length > 0 && tag.length <= 60 ? tag : null;
}

type CleanPost = {
  index: number;
  post: ProfilePost;
  time: number;
  /** Очищенный текст, PII-фрагменты уже вырезаны (для счёта слов и т.п.). */
  text: string;
  hadPii: boolean;
  /** Подпись пустая (или одни пробелы/управляющие символы) ещё до вырезания PII. */
  noCaption: boolean;
};

type RankedPost = { p: CleanPost; likes: number };

export function buildProfileFacts(
  snapshot: ProfileSnapshot,
  opts: { now?: Date } = {},
): ProfileFacts {
  const now = opts.now ?? new Date(snapshot.fetchedAt);

  const posts: CleanPost[] = snapshot.posts.flatMap((post, index) => {
    const time = Date.parse(post.takenAt);
    if (Number.isNaN(time)) return [];
    const sanitized = sanitizeText(post.caption);
    const { text, hadPii } = cleanUntrusted(post.caption);
    return [{ index, post, time, text, hadPii, noCaption: sanitized === "" }];
  });
  const n = posts.length;
  // Хронология: от старого к новому; при равенстве времени — по исходному индексу.
  const chrono = [...posts].sort((a, b) => a.time - b.time || a.index - b.index);
  const first = chrono[0];
  const last = chrono[n - 1];

  // ---- Статистика ----------------------------------------------------------
  // Постов в неделю = (n-1) интервалов на окно между первым и последним постом.
  // Окно короче суток (или <2 постов) — оценки нет, null.
  const windowDays = first && last ? (last.time - first.time) / DAY_MS : 0;
  const postsPerWeek = windowDays >= 1 ? round(((n - 1) / windowDays) * 7, 2) : null;
  const share = (count: number): number | null => (n === 0 ? null : round(count / n, 3));

  // Всё время в UTC: часового пояса профиля в снимке нет.
  const hours = new Map<string, number>();
  const weekdays = new Map<string, number>();
  const days = new Map<string, number>();
  for (const p of posts) {
    const d = new Date(p.time);
    bump(hours, String(d.getUTCHours()).padStart(2, "0"));
    bump(weekdays, String(d.getUTCDay()));
    bump(days, d.toISOString().slice(0, 10));
  }
  const topHour = topCounts(hours, 1, 1)[0];
  const topWeekday = topCounts(weekdays, 1, 1)[0];

  const likes = posts.flatMap((p) => (p.post.likesCount === null ? [] : [p.post.likesCount]));
  const avgLikes =
    likes.length === 0 ? null : round(likes.reduce((s, x) => s + x, 0) / likes.length, 1);

  // ---- Повторы -------------------------------------------------------------
  const tagCounts = new Map<string, number>();
  const locCounts = new Map<string, number>();
  const locDisplay = new Map<string, string>();
  const wordCounts = new Map<string, number>();
  for (const p of posts) {
    // Хэштег считается один раз на пост; поле hashtags + теги из текста подписи.
    const tags = new Set<string>();
    for (const raw of p.post.hashtags) {
      const t = normalizeHashtag(raw);
      if (t) tags.add(t);
    }
    for (const m of p.text.matchAll(INLINE_HASHTAG)) {
      const t = normalizeHashtag(m[1] ?? "");
      if (t) tags.add(t);
    }
    for (const t of tags) bump(tagCounts, t);

    if (p.post.locationName) {
      const loc = cleanUntrusted(p.post.locationName);
      // Локация бывает адресом («ул. Ленина 5»): с PII не берём вовсе.
      if (!loc.hadPii && loc.text.length > 0) {
        const text = capCodepoints(loc.text, 100);
        const key = text.toLowerCase();
        bump(locCounts, key);
        if (!locDisplay.has(key)) locDisplay.set(key, text);
      }
    }

    // Слова: PII уже вырезана; хэштеги и упоминания убираем; WORD ловит только буквы,
    // поэтому числа и ссылки (вырезаны ранее) в счёт не попадают.
    const prose = p.text.replace(INLINE_HASHTAG, " ").replace(MENTION, " ");
    for (const m of prose.matchAll(WORD)) {
      const w = normalizeWord(m[0]);
      const len = codepointLength(w);
      if (len < 3 || len > 40 || STOPWORDS.has(w)) continue;
      bump(wordCounts, w);
    }
  }

  // ---- Ритм ----------------------------------------------------------------
  let longestGapMs: number | null = null;
  for (let i = 1; i < n; i += 1) {
    const gap = (chrono[i]?.time ?? 0) - (chrono[i - 1]?.time ?? 0);
    if (longestGapMs === null || gap > longestGapMs) longestGapMs = gap;
  }
  const dayCounts = [...days.values()];
  const burstDays = dayCounts.filter((c) => c >= 3).length;

  const ranked: RankedPost[] = posts.flatMap((p) =>
    p.post.likesCount === null ? [] : [{ p, likes: p.post.likesCount }],
  );
  // Больше лайков — выше; равенство: более свежий, затем меньший индекс.
  ranked.sort((a, b) => b.likes - a.likes || b.p.time - a.p.time || a.p.index - b.p.index);
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  // «Провальный» осмыслен только если он реально хуже лучшего.
  const worst = top && bottom && bottom.likes < top.likes ? bottom : undefined;
  const postRef = (e: RankedPost | undefined) =>
    e
      ? {
          index: e.p.index,
          takenAt: e.p.post.takenAt,
          likes: e.likes,
          // Подпись с PII в LLM не идёт — и здесь тоже.
          caption: e.p.hadPii ? "" : capCodepoints(e.p.text, CAPTION_CAP),
        }
      : null;

  // ---- Язык и эмодзи -------------------------------------------------------
  const bio = cleanUntrusted(snapshot.biography);
  const captionText = posts.map((p) => p.text).join(" ");
  const allText = `${captionText} ${bio.text}`;
  const cyr = (allText.match(CYRILLIC) ?? []).length;
  const lat = (allText.match(LATIN) ?? []).length;
  // Эвристика по алфавиту: кириллица -> ru (укр/бел/каз/болг. НЕ различаем), латиница -> en
  // (es/de/fr/... тоже «en»). Нет букв или ничья — null: язык не угадан, fallback выберет
  // analyze (продукт русскоязычный, разумно "ru"); молча подсовывать "ru" здесь не хотим.
  const code = cyr > lat ? "ru" : lat > cyr ? "en" : null;
  // Каждая пиктограмма считается отдельно (ZWJ-последовательность = несколько).
  const emojiCount = (captionText.match(EMOJI_G) ?? []).length;
  const letterCount = (captionText.match(LETTER) ?? []).length;
  const emojiDenominator = emojiCount + letterCount;
  const postsWithEmoji = posts.filter((p) => EMOJI_ONE.test(p.text)).length;

  // ---- Данные для LLM ------------------------------------------------------
  const captionsForLlm = posts
    .filter((p) => !p.hadPii && p.text.length > 0)
    .slice(0, LIMITS.captionsForLlm)
    .map((p) => ({
      index: p.index,
      takenAt: p.post.takenAt,
      caption: capCodepoints(p.text, CAPTION_CAP),
    }));

  const facts: ProfileFacts = {
    postsAnalyzed: n,
    stats: {
      postsPerWeek,
      videoShare: share(posts.filter((p) => p.post.type === "video").length),
      carouselShare: share(posts.filter((p) => p.post.type === "carousel").length),
      topHourUtc: topHour ? Number(topHour.key) : null,
      topWeekdayUtc: topWeekday ? (WEEKDAYS[Number(topWeekday.key)] ?? null) : null,
      avgLikes,
      noCaptionShare: share(posts.filter((p) => p.noCaption).length),
    },
    repeats: {
      hashtags: topCounts(tagCounts, LIMITS.repeatMinCount, LIMITS.hashtags).map((c) => ({
        tag: c.key,
        count: c.count,
      })),
      locations: topCounts(locCounts, LIMITS.repeatMinCount, LIMITS.locations).map((c) => ({
        name: locDisplay.get(c.key) ?? c.key,
        count: c.count,
      })),
      words: topCounts(wordCounts, LIMITS.wordMinCount, LIMITS.words).map((c) => ({
        word: c.key,
        count: c.count,
      })),
    },
    rhythm: {
      longestGapDays: longestGapMs === null ? null : round(longestGapMs / DAY_MS, 1),
      burstDays,
      hasBurst: burstDays > 0,
      maxPostsInDay: dayCounts.reduce((m, c) => Math.max(m, c), 0),
      daysSinceLastPost: last ? round(Math.max(0, now.getTime() - last.time) / DAY_MS, 1) : null,
      topPost: postRef(top),
      worstPost: postRef(worst),
    },
    language: {
      code,
      emojiShare: emojiDenominator === 0 ? null : round(emojiCount / emojiDenominator, 3),
      emojiPostShare: share(postsWithEmoji),
    },
    pii: {
      captionsWithPii: posts.filter((p) => p.hadPii).length,
      biographyHadPii: bio.hadPii,
    },
    biography: capCodepoints(bio.text, BIO_CAP),
    captionsForLlm,
  };

  return ProfileFacts.parse(facts);
}
