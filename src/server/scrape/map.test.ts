import { describe, expect, it } from "vitest";
import { ProfileSnapshot } from "@/contracts";
import openProfile from "./fixtures/open-profile.json";
import { cleanText, mapPost, mapProfile, MAX_POSTS } from "./map";
import { RawProfile } from "./raw-schema";

const at = new Date("2026-10-03T12:00:00.000Z");

function basePost() {
  return {
    type: "Image",
    caption: "x",
    timestamp: "2026-09-01T10:00:00.000Z",
    displayUrl: "https://example.invalid/a.jpg",
  };
}

describe("mapProfile", () => {
  const raw = RawProfile.parse(openProfile[0]);
  const snapshot = mapProfile(raw, "test.user", at);

  it("даёт валидный ProfileSnapshot", () => {
    expect(ProfileSnapshot.safeParse(snapshot).success).toBe(true);
    expect(snapshot).toMatchObject({
      username: "test.user",
      fullName: "Тестовый Пользователь",
      followersCount: 1520,
      isPrivate: false,
      isVerified: false,
      avatarUrl: "https://scontent.example.invalid/v/avatar_hd.jpg",
      fetchedAt: "2026-10-03T12:00:00.000Z",
    });
  });

  it("режет посты до 24 (в фикстуре 31 запись, одна битая)", () => {
    expect(openProfile[0]?.latestPosts).toHaveLength(31);
    expect(snapshot.posts).toHaveLength(MAX_POSTS);
  });

  it("сортирует от новых к старым", () => {
    const dates = snapshot.posts.map((p) => p.takenAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("не тащит комменты и прочие лишние поля", () => {
    expect(JSON.stringify(snapshot)).not.toContain("fake_user");
    expect(Object.keys(snapshot.posts[0] ?? {}).sort()).toEqual(
      [
        "caption",
        "commentsCount",
        "hashtags",
        "imageUrl",
        "likesCount",
        "locationName",
        "takenAt",
        "type",
      ].sort(),
    );
  });

  it("скрытые лайки (-1) становятся null", () => {
    expect(snapshot.posts.some((p) => p.likesCount === null)).toBe(true);
    expect(snapshot.posts.every((p) => p.likesCount === null || p.likesCount >= 0)).toBe(true);
  });
});

describe("mapPost", () => {
  it("Image/Video/Sidecar → image/video/carousel", () => {
    expect(mapPost({ ...basePost(), type: "Image" })?.type).toBe("image");
    expect(mapPost({ ...basePost(), type: "Video" })?.type).toBe("video");
    expect(mapPost({ ...basePost(), type: "Sidecar" })?.type).toBe("carousel");
  });

  it("невалидные и небезопасные URL → null, пост остаётся", () => {
    expect(mapPost({ ...basePost(), displayUrl: "javascript:alert(1)" })?.imageUrl).toBeNull();
    expect(mapPost({ ...basePost(), displayUrl: "not a url" })?.imageUrl).toBeNull();
    expect(mapPost({ ...basePost(), displayUrl: "data:text/html,x" })?.imageUrl).toBeNull();
  });

  it("пост с неизвестным типом, битой датой или не объект пропускается", () => {
    expect(mapPost({ ...basePost(), type: "Reel?" })).toBeNull();
    expect(mapPost({ ...basePost(), timestamp: "вчера" })).toBeNull();
    expect(mapPost("мусор")).toBeNull();
  });

  it("хэштеги из поля или из подписи, без дублей и решёток", () => {
    expect(mapPost({ ...basePost(), hashtags: ["#один", "два"] })?.hashtags).toEqual([
      "один",
      "два",
    ]);
    expect(mapPost({ ...basePost(), caption: "привет #мир #мир" })?.hashtags).toEqual(["мир"]);
  });

  it("принимает unix-время в секундах", () => {
    expect(mapPost({ ...basePost(), timestamp: 1788000000 })?.takenAt).toBe(
      new Date(1788000000 * 1000).toISOString(),
    );
  });
});

describe("cleanText: строка должна пройти в jsonb", () => {
  it("убирает NUL", () => {
    expect(cleanText("a\u0000b", 10)).toBe("ab");
  });
  it("не режет эмодзи пополам на границе", () => {
    // "a" + 😀 (2 UTF-16 единицы): срез на 2 оставил бы одиночный суррогат.
    expect(cleanText("a\u{1F600}", 2)).toBe("a");
    expect(cleanText("a\u{1F600}", 3)).toBe("a\u{1F600}");
  });
  it("одиночные суррогаты внутри → U+FFFD", () => {
    expect(cleanText("x\uDC00y\uD800z", 10)).toBe("x\uFFFDy\uFFFDz");
  });
  it("подпись с эмодзи на границе 2200 даёт валидный пост", () => {
    const caption = "a".repeat(2199) + "\u{1F600}";
    const post = mapPost({ ...basePost(), caption });
    expect(post?.caption).toBe("a".repeat(2199));
  });
});
