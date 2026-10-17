import type { ProfileSnapshot } from "@/contracts";
import type { FetchCoversFn } from "../analyze/cover-fetch";
import { httpUrl, pickCovers, type Cover } from "../analyze/covers";
import type { ProfileFacts } from "../facts";
import { capCodepoints, cleanUntrusted, sanitizeText } from "../facts/text";
import { MAX_IMAGE_BYTES_TOTAL, MAX_IMAGES, MAX_MATERIAL_POSTS } from "./config";
import type { ComedyMaterial, ImageLabel, MaterialImage, MaterialPost } from "./types";

// Материал comedy-движка (comedy-engine §2): адаптер снимка Apify и блок `<profile_data>`.
// Подписи берутся из `ProfileFacts.captionsForLlm`: там уже вырезана PII. Хэштеги и локации
// чистятся тем же `cleanUntrusted`: локация бывает адресом, с PII она не берётся вовсе.

/** Номер аватара в списке обложек для `fetchCovers` (у постов номера с нуля). */
const AVATAR_INDEX = -1;
const NAME_CAP = 100;
const HASHTAG_CAP = 60;
const LOCATION_CAP = 100;
const HASHTAGS_PER_POST = 10;
const EXTRA_FACTS_MAX = 5;
const EXTRA_FACT_CAP = 140;

/** Имя из шапки: бывает с телефоном («Ногти | +7 999…»), поэтому та же чистка PII, что у подписей. */
export function cleanName(raw: string): string {
  return capCodepoints(cleanUntrusted(raw).text, NAME_CAP);
}

/** Данные профиля в промпт только так: закрыть тег `<profile_data>` невозможно. */
export function defang(text: string): string {
  return text.replace(/</g, "‹").replace(/>/g, "›");
}

/** Домен ссылки из шапки: путь не берём (`wa.me/<телефон>`, `t.me/<ник>`). */
export function externalHost(url: string | null): string | null {
  const safe = httpUrl(url);
  return safe ? new URL(safe).hostname.toLowerCase() : null;
}

/** Хэштег без `#`, PII и мусора; `null`, если ничего не осталось. */
export function cleanTag(raw: string): string | null {
  const { text, hadPii } = cleanUntrusted(raw.replace(/^#+/, ""));
  if (hadPii) return null;
  const tag = text.replace(/[^\p{L}\p{N}_]/gu, "");
  return tag.length > 0 ? capCodepoints(tag, HASHTAG_CAP) : null;
}

/** Локация: с PII (адрес) не берётся вовсе. */
export function cleanLocation(raw: string | null): string | null {
  if (!raw) return null;
  const { text, hadPii } = cleanUntrusted(raw);
  return hadPii || text === "" ? null : capCodepoints(text, LOCATION_CAP);
}

/** Факты пользователя: чистка, потолок 140, не больше 5 (как в контракте `ExtraFact`). */
export function cleanExtraFacts(extra: readonly string[]): string[] {
  return extra
    .map((f) => capCodepoints(sanitizeText(f), EXTRA_FACT_CAP))
    .filter((f) => f !== "")
    .slice(0, EXTRA_FACTS_MAX);
}

/** Факты кода без подписей и био: они идут в блок отдельно. */
function computedFacts(facts: ProfileFacts): Record<string, unknown> {
  const computed: Partial<ProfileFacts> = { ...facts };
  delete computed.captionsForLlm;
  delete computed.biography;
  return computed;
}

/** Обложки и аватар для vision: те же правила, что у `analyze` (allowlist CDN, 512 px). */
export function materialCovers(snapshot: ProfileSnapshot): Cover[] {
  const posts = { ...snapshot, posts: snapshot.posts.slice(0, MAX_MATERIAL_POSTS) };
  const covers = pickCovers(posts, MAX_IMAGES);
  const avatar = httpUrl(snapshot.avatarUrl);
  return avatar ? [{ index: AVATAR_INDEX, url: avatar }, ...covers] : covers;
}

/**
 * Скачивает картинки материала. Не бросает: недоступные пропускаются. Аватар первым, потом
 * обложки по номеру поста. Сумма байтов ограничена `MAX_IMAGE_BYTES_TOTAL` (лимит запроса).
 */
export async function fetchMaterialImages(
  snapshot: ProfileSnapshot,
  fetchCovers: FetchCoversFn,
): Promise<MaterialImage[]> {
  const covers = materialCovers(snapshot);
  if (covers.length === 0) return [];
  const downloaded = await fetchCovers(covers);
  const sorted = [...downloaded].sort((a, b) => a.index - b.index);
  const out: MaterialImage[] = [];
  let total = 0;
  for (const c of sorted) {
    if (total + c.data.byteLength > MAX_IMAGE_BYTES_TOTAL) continue;
    total += c.data.byteLength;
    const label: ImageLabel = c.index === AVATAR_INDEX ? "avatar" : `post:${c.index}`;
    out.push({ label, data: c.data, mediaType: c.mediaType });
  }
  return out;
}

/** Адаптер прода (§2): снимок Apify + факты кода + картинки → материал. */
export function fromSnapshot(
  snapshot: ProfileSnapshot,
  facts: ProfileFacts,
  extraFacts: readonly string[],
  images: readonly MaterialImage[],
): ComedyMaterial {
  const captions = new Map(facts.captionsForLlm.map((c) => [c.index, c.caption]));
  const posts: MaterialPost[] = snapshot.posts.slice(0, MAX_MATERIAL_POSTS).map((post, index) => ({
    index,
    takenAt: post.takenAt,
    type: post.type === "image" ? "photo" : post.type,
    caption: captions.get(index) ?? "",
    hashtags: post.hashtags
      .map(cleanTag)
      .filter((t): t is string => t !== null)
      .slice(0, HASHTAGS_PER_POST),
    location: cleanLocation(post.locationName),
    likes: post.likesCount,
    comments: post.commentsCount,
  }));
  return {
    source: "apify",
    username: capCodepoints(sanitizeText(snapshot.username), NAME_CAP),
    displayName: cleanName(snapshot.fullName),
    biography: facts.biography,
    counters: {
      posts: snapshot.postsCount,
      followers: snapshot.followersCount,
      following: snapshot.followsCount,
    },
    externalUrl: externalHost(snapshot.externalUrl),
    posts,
    facts: computedFacts(facts),
    images: [...images],
    extraFacts: cleanExtraFacts(extraFacts),
  };
}

const num = (n: number | null) => (n === null ? "?" : String(n));

function postLine(p: MaterialPost): string {
  const meta = [
    p.takenAt ? p.takenAt.slice(0, 10) : null,
    p.type,
    p.likes === null ? null : `лайков ${p.likes}`,
  ]
    .concat(p.comments === null ? [] : [`комментариев ${p.comments}`])
    .filter((x): x is string => x !== null);
  const tags = p.hashtags.map((t) => `#${t}`).join(" ");
  const parts = [
    `[post:${p.index}]`,
    meta.length > 0 ? `(${meta.join(", ")})` : "",
    p.caption === "" ? "(без подписи)" : p.caption,
    tags,
    p.location ? `@${p.location}` : "",
  ];
  return parts.filter((x) => x !== "").join(" ");
}

function postRange(posts: readonly MaterialPost[]): string {
  if (posts.length === 0) return "0";
  const indexes = posts.map((p) => p.index);
  return `${posts.length} (post:${Math.min(...indexes)} … post:${Math.max(...indexes)})`;
}

/**
 * Блок недоверенных данных для профиля (§7.1): имя, ник, био, счётчики, ссылка, посты, факты
 * кода, факты заказчика. Весь текст проходит `defang`, даже уже очищенный: второй рубеж.
 */
export function profileDataBlock(m: ComedyMaterial): string {
  const body = [
    `Имя: ${m.displayName === "" ? "(нет)" : m.displayName}`,
    `Ник: ${m.username}`,
    `Био: ${m.biography === "" ? "(пусто)" : m.biography}`,
    `Постов: ${num(m.counters.posts)}, подписчиков: ${num(m.counters.followers)}, подписок: ${num(m.counters.following)}`,
    `Ссылка в шапке: ${m.externalUrl ?? "(нет)"}`,
    `Постов во входе: ${postRange(m.posts)}`,
    "",
    "Факты, посчитанные кодом (цифрам верь, свои не считай):",
    m.facts ? JSON.stringify(m.facts) : "(нет)",
    "",
    "Посты:",
    m.posts.length === 0 ? "(нет)" : m.posts.map(postLine).join("\n"),
    "",
    m.extraFacts.length === 0
      ? "Со слов заказчика: (ничего)"
      : `Со слов заказчика (не проверено):\n${m.extraFacts.map((f) => `- ${f}`).join("\n")}`,
  ].join("\n");
  return `<profile_data>\n${defang(body)}\n</profile_data>`;
}

/** Подпись перед картинкой в сообщении модели. */
export function imageCaption(label: ImageLabel): string {
  return label === "avatar" ? "Аватар" : `Картинка поста ${label}`;
}
