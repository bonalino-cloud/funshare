import { z } from "zod";

// Только BE. Permissive-схема «сырого» ответа Apify `instagram-profile-scraper`.
// Её задача — убедиться, что ответ вообще похож на профиль; строгую проверку делает
// `ProfileSnapshot.parse()` после маппинга. Поля, которые мы не берём (комменты, подписчики,
// сторис), схема не описывает, и `z.object` их отбрасывает.

const optionalString = z.string().nullish();
// Apify местами отдаёт числа строками или -1 («скрыто»): приводим в маппинге, не здесь.
const optionalNumber = z.union([z.number(), z.string()]).nullish();

export const RawPost = z.object({
  type: optionalString,
  caption: optionalString,
  hashtags: z.array(z.unknown()).nullish(),
  timestamp: z.union([z.string(), z.number()]).nullish(),
  likesCount: optionalNumber,
  commentsCount: optionalNumber,
  locationName: optionalString,
  displayUrl: optionalString,
});
export type RawPost = z.infer<typeof RawPost>;

export const RawProfile = z.object({
  username: optionalString,
  fullName: optionalString,
  biography: optionalString,
  profilePicUrl: optionalString,
  profilePicUrlHD: optionalString,
  externalUrl: optionalString,
  followersCount: optionalNumber,
  followsCount: optionalNumber,
  postsCount: optionalNumber,
  private: z.boolean().nullish(),
  verified: z.boolean().nullish(),
  // Элементы постов проверяются по одному в маппинге: один кривой пост не должен ронять профиль.
  latestPosts: z.array(z.unknown()).nullish(),
});
export type RawProfile = z.infer<typeof RawProfile>;

/** Элемент датасета с ошибкой (профиль не найден и т. п.): `{ error: "...", errorDescription: "..." }`. */
export const RawErrorItem = z.object({
  error: z.union([z.string(), z.boolean(), z.number()]),
  errorDescription: optionalString,
});

/** Датасет — массив элементов; что внутри, разбираем уже по одному. */
export const RawDataset = z.array(z.unknown());
