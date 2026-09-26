import { z } from "zod";

// Только BE. Нормализованный снимок профиля после скрейпа — вход шага `analyze`.

export const ProfilePost = z.object({
  type: z.enum(["image", "video", "carousel"]),
  caption: z.string(),
  hashtags: z.array(z.string()),
  takenAt: z.iso.datetime(),
  likesCount: z.number().int().nonnegative().nullable(),
  commentsCount: z.number().int().nonnegative().nullable(),
  imageUrl: z.url().nullable(),
  locationName: z.string().nullable(),
});
export type ProfilePost = z.infer<typeof ProfilePost>;

export const ProfileSnapshot = z.object({
  username: z.string().min(1),
  fullName: z.string(),
  biography: z.string(),
  avatarUrl: z.url().nullable(),
  externalUrl: z.url().nullable(),
  isPrivate: z.boolean(),
  isVerified: z.boolean(),
  followersCount: z.number().int().nonnegative(),
  followsCount: z.number().int().nonnegative(),
  postsCount: z.number().int().nonnegative(),
  posts: z.array(ProfilePost),
  fetchedAt: z.iso.datetime(),
});
export type ProfileSnapshot = z.infer<typeof ProfileSnapshot>;
