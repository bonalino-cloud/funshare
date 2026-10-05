import { describe, expect, it } from "vitest";
import { ProfileSnapshot } from "@/contracts/profile";
import { buildProfileFacts } from "./build";
import { LIMITS, ProfileFacts } from "./schema";
import { at, enProfile, makePost, makeSnapshot, richRu } from "./fixtures";

describe("фикстуры", () => {
  it("валидны по ProfileSnapshot", () => {
    expect(() => ProfileSnapshot.parse(richRu())).not.toThrow();
    expect(() => ProfileSnapshot.parse(enProfile())).not.toThrow();
  });
});

describe("статистика", () => {
  const facts = buildProfileFacts(richRu());

  it("постов в неделю по окну между первым и последним", () => {
    expect(facts.postsAnalyzed).toBe(5);
    expect(facts.stats.postsPerWeek).toBeCloseTo(3.71, 2);
  });
  it("доли видео, каруселей и постов без подписи", () => {
    expect(facts.stats.videoShare).toBe(0.2);
    expect(facts.stats.carouselShare).toBe(0.2);
    expect(facts.stats.noCaptionShare).toBe(0.2);
  });
  it("самый частый час и день недели (UTC)", () => {
    expect(facts.stats.topHourUtc).toBe(18);
    expect(facts.stats.topWeekdayUtc).toBe("wed");
  });
  it("средние лайки", () => {
    expect(facts.stats.avgLikes).toBe(104);
  });
  it("средние лайки считаются только по известным значениям", () => {
    const f = buildProfileFacts(
      makeSnapshot([
        makePost({ likesCount: 10, takenAt: at(1) }),
        makePost({ likesCount: null, takenAt: at(2) }),
        makePost({ likesCount: 20, takenAt: at(3) }),
      ]),
    );
    expect(f.stats.avgLikes).toBe(15);
  });
  it("подпись из одних пробелов и управляющих символов считается пустой", () => {
    const f = buildProfileFacts(makeSnapshot([makePost({ caption: " \n\t\u0000 " })]));
    expect(f.stats.noCaptionShare).toBe(1);
  });
});

describe("пограничные случаи", () => {
  it("0 постов", () => {
    const f = buildProfileFacts(makeSnapshot([]));
    expect(f.postsAnalyzed).toBe(0);
    expect(f.stats).toEqual({
      postsPerWeek: null,
      videoShare: null,
      carouselShare: null,
      topHourUtc: null,
      topWeekdayUtc: null,
      avgLikes: null,
      noCaptionShare: null,
    });
    expect(f.rhythm.longestGapDays).toBeNull();
    expect(f.rhythm.daysSinceLastPost).toBeNull();
    expect(f.rhythm.topPost).toBeNull();
    expect(f.rhythm.hasBurst).toBe(false);
    expect(f.language).toEqual({ code: null, emojiShare: null, emojiPostShare: null });
    expect(f.captionsForLlm).toEqual([]);
  });

  it("1 пост: темп и пауза неопределены, остальное считается", () => {
    const f = buildProfileFacts(makeSnapshot([makePost({ caption: "Привет", likesCount: 3 })]));
    expect(f.stats.postsPerWeek).toBeNull();
    expect(f.rhythm.longestGapDays).toBeNull();
    expect(f.stats.topHourUtc).toBe(12);
    expect(f.rhythm.topPost?.likes).toBe(3);
    // единственный пост не может быть и лучшим, и худшим
    expect(f.rhythm.worstPost).toBeNull();
  });

  it("все посты без лайков: avgLikes, лучший и худший = null", () => {
    const f = buildProfileFacts(
      makeSnapshot([makePost({ takenAt: at(1) }), makePost({ takenAt: at(5) })]),
    );
    expect(f.stats.avgLikes).toBeNull();
    expect(f.rhythm.topPost).toBeNull();
    expect(f.rhythm.worstPost).toBeNull();
  });

  it("все лайки равны: худшего нет", () => {
    const f = buildProfileFacts(
      makeSnapshot([
        makePost({ takenAt: at(1), likesCount: 5 }),
        makePost({ takenAt: at(2), likesCount: 5 }),
      ]),
    );
    expect(f.rhythm.topPost).not.toBeNull();
    expect(f.rhythm.worstPost).toBeNull();
  });

  it("все посты в один день: темп null (окно < суток), взрыв считается", () => {
    const f = buildProfileFacts(
      makeSnapshot([1, 2, 3, 4].map((h) => makePost({ takenAt: at(4, h) }))),
    );
    expect(f.stats.postsPerWeek).toBeNull();
    expect(f.rhythm.burstDays).toBe(1);
    expect(f.rhythm.maxPostsInDay).toBe(4);
    expect(f.rhythm.longestGapDays).toBe(0.0);
  });

  it("порядок постов во входе не влияет на хронологические метрики", () => {
    const a = buildProfileFacts(richRu());
    const reversed = richRu();
    reversed.posts.reverse();
    const b = buildProfileFacts(reversed);
    expect(b.stats).toEqual(a.stats);
    expect(b.rhythm.longestGapDays).toBe(a.rhythm.longestGapDays);
  });
});

describe("повторы", () => {
  const facts = buildProfileFacts(richRu());

  it("хэштеги: регистр нормализован, пост считается один раз, одиночные не в «повторах»", () => {
    expect(facts.repeats.hashtags).toEqual([{ tag: "закат", count: 2 }]);
  });
  it("локации: регистр объединён, показывается первая форма", () => {
    expect(facts.repeats.locations).toEqual([{ name: "Сочи", count: 3 }]);
  });
  it("слова: ровно 5 вхождений попадает (порог >4), хэштеги в счёт не идут", () => {
    expect(facts.repeats.words).toEqual([{ word: "закат", count: 5 }]);
  });
  it("слова: 4 вхождения не попадают", () => {
    const f = buildProfileFacts(
      makeSnapshot([makePost({ caption: "тропа тропа тропа тропа", takenAt: at(1) })]),
    );
    expect(f.repeats.words).toEqual([]);
  });
  it("слова: ё=е, регистр, стоп-слова, числа и упоминания не считаются", () => {
    const caption =
      "Ёжик ежик ЕЖИК еЖиК ёжик и и и и и это это это это это 2024 2024 2024 2024 2024 @friend @friend @friend @friend @friend";
    const f = buildProfileFacts(makeSnapshot([makePost({ caption, takenAt: at(1) })]));
    expect(f.repeats.words).toEqual([{ word: "ежик", count: 5 }]);
  });
  it("английские стоп-слова отсекаются", () => {
    const f = buildProfileFacts(
      makeSnapshot([makePost({ caption: "the the the the the walk walk walk walk walk" })]),
    );
    expect(f.repeats.words).toEqual([{ word: "walk", count: 5 }]);
  });
  it("хэштеги из текста подписи тоже считаются", () => {
    const f = buildProfileFacts(
      makeSnapshot([
        makePost({ caption: "день #Trip", takenAt: at(1) }),
        makePost({ caption: "ночь", hashtags: ["#trip"], takenAt: at(2) }),
      ]),
    );
    expect(f.repeats.hashtags).toEqual([{ tag: "trip", count: 2 }]);
  });
  it("топы ограничены по размеру", () => {
    const words = Array.from({ length: 30 }, (_, k) => `слово${String.fromCharCode(1072 + k)}`);
    const posts = Array.from({ length: 30 }, (_, i) =>
      makePost({
        takenAt: at(1 + (i % 20), i % 24),
        hashtags: Array.from({ length: 15 }, (_, k) => `tag${k}`),
        locationName: `Place${i % 8}`,
        caption: words.join(" "),
      }),
    );
    const f = buildProfileFacts(makeSnapshot(posts));
    expect(f.repeats.hashtags).toHaveLength(LIMITS.hashtags);
    expect(f.repeats.locations).toHaveLength(LIMITS.locations);
    expect(f.repeats.words).toHaveLength(LIMITS.words);
    expect(f.captionsForLlm.length).toBeLessThanOrEqual(LIMITS.captionsForLlm);
  });
  it("равные частоты сортируются стабильно (по ключу)", () => {
    const mk = (order: string[]) =>
      buildProfileFacts(
        makeSnapshot([
          makePost({ hashtags: order, takenAt: at(1) }),
          makePost({ hashtags: order, takenAt: at(2) }),
        ]),
      ).repeats.hashtags.map((h) => h.tag);
    expect(mk(["b", "c", "a"])).toEqual(["a", "b", "c"]);
    expect(mk(["a", "c", "b"])).toEqual(["a", "b", "c"]);
  });
});

describe("ритм", () => {
  const facts = buildProfileFacts(richRu());

  it("самая длинная пауза и взрыв", () => {
    expect(facts.rhythm.longestGapDays).toBe(6.5);
    expect(facts.rhythm.burstDays).toBe(1);
    expect(facts.rhythm.hasBurst).toBe(true);
    expect(facts.rhythm.maxPostsInDay).toBe(3);
  });
  it("давность последнего поста считается от fetchedAt; now можно передать", () => {
    expect(facts.rhythm.daysSinceLastPost).toBe(1.2);
    const f = buildProfileFacts(richRu(), { now: new Date(at(19, 7)) });
    expect(f.rhythm.daysSinceLastPost).toBe(10);
  });
  it("пост из «будущего» (часы скрейпера отстают): давность 0, а не отрицательная", () => {
    const f = buildProfileFacts(makeSnapshot([makePost({ takenAt: at(20) })]));
    expect(f.rhythm.daysSinceLastPost).toBe(0);
  });
  it("лучший и худший по лайкам: индекс, время, очищенная подпись, без imageUrl", () => {
    expect(facts.rhythm.topPost).toMatchObject({ index: 1, likes: 300 });
    expect(facts.rhythm.worstPost).toMatchObject({
      index: 2,
      likes: 10,
      caption: "Кофе и закат",
    });
    expect(JSON.stringify(facts)).not.toContain("imageUrl");
  });
  it("подпись лучшего поста с PII не попадает в вывод", () => {
    const f = buildProfileFacts(
      makeSnapshot([
        makePost({ caption: "звоните +7 999 123-45-67", likesCount: 100, takenAt: at(1) }),
        makePost({ caption: "ок", likesCount: 1, takenAt: at(2) }),
      ]),
    );
    expect(f.rhythm.topPost?.caption).toBe("");
    expect(JSON.stringify(f)).not.toMatch(/123-45-67|999/);
  });
});

describe("язык и эмодзи", () => {
  it("кириллица -> ru", () => {
    expect(buildProfileFacts(richRu()).language.code).toBe("ru");
  });
  it("латиница -> en", () => {
    expect(buildProfileFacts(enProfile()).language.code).toBe("en");
  });
  it("украинский тоже ru (не различаем)", () => {
    const f = buildProfileFacts(makeSnapshot([makePost({ caption: "Привіт, їжак" })]));
    expect(f.language.code).toBe("ru");
  });
  it("нет букв (только эмодзи/пусто) -> null", () => {
    const emojiOnly = makeSnapshot([makePost({ caption: "🔥🔥" })]);
    expect(buildProfileFacts(emojiOnly).language.code).toBeNull();
    expect(buildProfileFacts(makeSnapshot([])).language.code).toBeNull();
  });
  it("смешанный: побеждает преобладающий алфавит; ничья -> null", () => {
    const lang = (caption: string) =>
      buildProfileFacts(makeSnapshot([makePost({ caption })])).language.code;
    expect(lang("Привет hi")).toBe("ru");
    expect(lang("Да hello")).toBe("en");
    expect(lang("ab вг")).toBeNull();
  });
  it("био учитывается, когда подписей нет", () => {
    const f = buildProfileFacts(makeSnapshot([], { biography: "Фотограф" }));
    expect(f.language.code).toBe("ru");
  });
  it("доля эмодзи", () => {
    const f = buildProfileFacts(
      makeSnapshot([
        makePost({ caption: "ab🔥🔥", takenAt: at(1) }),
        makePost({ caption: "abcd", takenAt: at(2) }),
      ]),
    );
    // 2 эмодзи / (2 + 6 букв)
    expect(f.language.emojiShare).toBe(0.25);
    expect(f.language.emojiPostShare).toBe(0.5);
  });
});

describe("подписи для LLM", () => {
  it("кэп 300 кодпоинтов, эмодзи не режется", () => {
    const f = buildProfileFacts(makeSnapshot([makePost({ caption: "😀".repeat(400) })]));
    const out = f.captionsForLlm[0]?.caption ?? "";
    expect(Array.from(out)).toHaveLength(300);
    expect(out).toBe("😀".repeat(300));
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(() => ProfileFacts.parse(f)).not.toThrow();
  });
  it("кэп применяется и к подписи в topPost, и к био", () => {
    const long = "а".repeat(1000);
    const f = buildProfileFacts(
      makeSnapshot(
        [
          makePost({ caption: long, likesCount: 9, takenAt: at(1) }),
          makePost({ caption: "x", likesCount: 1, takenAt: at(2) }),
        ],
        { biography: long },
      ),
    );
    expect(Array.from(f.rhythm.topPost?.caption ?? "")).toHaveLength(300);
    expect(Array.from(f.biography)).toHaveLength(500);
  });
  it("управляющие символы, нулевой байт, bidi и zero-width убираются, переносы -> пробел", () => {
    const caption = "а\u0000б‮в​г\nд\tф\u0007ж";
    const f = buildProfileFacts(makeSnapshot([makePost({ caption })]));
    expect(f.captionsForLlm[0]?.caption).toBe("абвг д фж");
  });
  it("ZWJ-эмодзи сохраняется, одиночные суррогаты вычищаются", () => {
    const f = buildProfileFacts(makeSnapshot([makePost({ caption: "👨‍👩‍👧 ok \ud83d" })]));
    expect(f.captionsForLlm[0]?.caption).toBe("👨‍👩‍👧 ok");
  });
  it("пустые подписи в LLM не идут; индекс указывает на исходный пост", () => {
    const f = buildProfileFacts(richRu());
    expect(f.captionsForLlm.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });
  it("не более 24 подписей", () => {
    const posts = Array.from({ length: 40 }, (_, i) =>
      makePost({ caption: `пост ${i}`, takenAt: at(1 + (i % 28)) }),
    );
    expect(buildProfileFacts(makeSnapshot(posts)).captionsForLlm).toHaveLength(24);
  });
});

describe("детерминизм", () => {
  it("одинаковый вход -> одинаковый выход", () => {
    expect(buildProfileFacts(richRu())).toEqual(buildProfileFacts(richRu()));
    expect(JSON.stringify(buildProfileFacts(richRu()))).toBe(
      JSON.stringify(buildProfileFacts(richRu())),
    );
  });
  it("вход не мутируется", () => {
    const snap = richRu();
    const copy = structuredClone(snap);
    buildProfileFacts(snap);
    expect(snap).toEqual(copy);
  });
});
