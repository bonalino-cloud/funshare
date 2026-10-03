import type { ProfilePost, ProfileSnapshot } from "@/contracts/profile";

// Выдуманные данные: людей, телефонов и адресов здесь не существует.

export function makePost(over: Partial<ProfilePost> = {}): ProfilePost {
  return {
    type: "image",
    caption: "",
    hashtags: [],
    takenAt: "2026-09-01T12:00:00.000Z",
    likesCount: null,
    commentsCount: null,
    imageUrl: null,
    locationName: null,
    ...over,
  };
}

export function makeSnapshot(
  posts: ProfilePost[] = [],
  over: Partial<ProfileSnapshot> = {},
): ProfileSnapshot {
  return {
    username: "test_user",
    fullName: "Тест Тестов",
    biography: "",
    avatarUrl: null,
    externalUrl: null,
    isPrivate: false,
    isVerified: false,
    followersCount: 100,
    followsCount: 50,
    postsCount: posts.length,
    posts,
    fetchedAt: "2026-09-10T12:00:00.000Z",
    ...over,
  };
}

/** Дата `day` сентября 2026 в заданный час UTC. */
export const at = (day: number, hour = 12): string =>
  `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

/** Богатый русскоязычный профиль: повторы, лайки, взрыв, локации. */
export const richRu = (): ProfileSnapshot =>
  makeSnapshot(
    [
      makePost({
        type: "video",
        caption: "Закат на море снова #Закат",
        hashtags: ["Закат", "море"],
        takenAt: at(1, 18),
        likesCount: 120,
        locationName: "Сочи",
      }),
      makePost({
        type: "carousel",
        caption: "Закат опять. Закат всегда.",
        hashtags: ["закат"],
        takenAt: at(2, 18),
        likesCount: 300,
        locationName: "сочи",
      }),
      makePost({
        caption: "Кофе и закат",
        hashtags: ["кофе"],
        takenAt: at(2, 19),
        likesCount: 10,
        locationName: "Сочи",
      }),
      makePost({ caption: "Закат ёжик", takenAt: at(2, 20), likesCount: 50 }),
      makePost({ caption: "", takenAt: at(9, 7), likesCount: 40 }),
    ],
    { biography: "Фотограф. Люблю море ☀️", fetchedAt: at(10, 12) },
  );

export const enProfile = (): ProfileSnapshot =>
  makeSnapshot(
    [
      makePost({ caption: "Morning coffee and a long walk", takenAt: at(1), likesCount: 5 }),
      makePost({ caption: "Another walk", takenAt: at(3), likesCount: 7 }),
    ],
    { biography: "Coffee lover" },
  );
