import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Artifact } from "@/contracts";
import { newSlug } from "../generations/assemble";
import { hashValue } from "../hash";
import { OWNER_COOKIE } from "../profile-check/config";
import { getArtifactResponse, isArtifactSlug, readArtifact, toArtifact } from "./read";
import type { ArtifactReadRepository, ArtifactReadRow } from "./repository";

const SLUG = "AbCdEfGh12";
const TOKEN = "A".repeat(43);
const OTHER_TOKEN = "B".repeat(43);

function makeRow(over: Partial<ArtifactReadRow> = {}): ArtifactReadRow {
  return {
    slug: SLUG,
    kind: "roast_v1",
    content: {
      title: "Прожарка @nasa",
      tagline: "2 шутки про @nasa",
      punches: [
        { id: "p1", emoji: "🔥", text: "Первая <b>шутка</b>" },
        { id: "p2", emoji: "😅", text: "Вторая шутка" },
      ],
      finale: "Всё это любя.",
      shareText: "Прожарка @nasa",
    },
    images: [],
    subject: null,
    ownerTokenHash: hashValue("owner", TOKEN),
    createdAt: new Date("2026-10-05T12:00:00.000Z"),
    deletedAt: null,
    mode: "self",
    igUsername: "nasa",
    profile: {
      username: "nasa",
      displayName: "NASA",
      avatarUrl: "https://blob.example/avatars/nasa.webp",
      postsCount: 100,
    },
    ...over,
  };
}

function makeRepo(row: ArtifactReadRow | null) {
  const findBySlug = vi.fn<ArtifactReadRepository["findBySlug"]>(async () => row);
  return { repo: { findBySlug }, findBySlug };
}

const req = (token?: string) =>
  new NextRequest(`http://localhost/api/artifacts/${SLUG}`, {
    headers: token ? { cookie: `${OWNER_COOKIE}=${token}` } : {},
  });

afterEach(() => vi.restoreAllMocks());

describe("isArtifactSlug", () => {
  it("принимает всё, что выдаёт newSlug, и отсекает чужой формат", () => {
    for (let i = 0; i < 200; i += 1) expect(isArtifactSlug(newSlug())).toBe(true);
    for (const bad of [
      "",
      "short",
      "AbCdEfGh123",
      "AbCdEfGh1-",
      "AbCdEfGh1 ",
      "../etc/pw",
      "ЖЖЖЖЖЖЖЖЖЖ",
    ]) {
      expect(isArtifactSlug(bad)).toBe(false);
    }
  });
});

describe("readArtifact", () => {
  it("found: артефакт проходит контракт, гость — isOwner false", async () => {
    const { repo, findBySlug } = makeRepo(makeRow());
    const result = await readArtifact({ repo }, SLUG);
    expect(findBySlug).toHaveBeenCalledWith(SLUG);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(Artifact.safeParse(result.artifact).success).toBe(true);
    expect(result.artifact.isOwner).toBe(false);
    expect(result.artifact.subject).toEqual({
      username: "nasa",
      displayName: "NASA",
      avatarUrl: "https://blob.example/avatars/nasa.webp",
    });
    expect(result.artifact.createdAt).toBe("2026-10-05T12:00:00.000Z");
  });

  it("isOwner true только с cookie владельца", async () => {
    const { repo } = makeRepo(makeRow());
    const own = await readArtifact({ repo }, SLUG, TOKEN);
    const other = await readArtifact({ repo }, SLUG, OTHER_TOKEN);
    const garbage = await readArtifact({ repo }, SLUG, "not-a-token");
    expect(own.status === "found" && own.artifact.isOwner).toBe(true);
    expect(other.status === "found" && other.artifact.isOwner).toBe(false);
    expect(garbage.status === "found" && garbage.artifact.isOwner).toBe(false);
  });

  it("невалидный slug: not_found без похода в БД", async () => {
    const { repo, findBySlug } = makeRepo(makeRow());
    expect(await readArtifact({ repo }, "nope")).toEqual({ status: "not_found" });
    expect(await readArtifact({ repo }, "x".repeat(100))).toEqual({ status: "not_found" });
    expect(findBySlug).not.toHaveBeenCalled();
  });

  it("несуществующий slug: not_found", async () => {
    const { repo } = makeRepo(null);
    expect(await readArtifact({ repo }, SLUG)).toEqual({ status: "not_found" });
  });

  it("deletedAt задан: gone, содержимого нет", async () => {
    const { repo } = makeRepo(makeRow({ deletedAt: new Date() }));
    expect(await readArtifact({ repo }, SLUG, TOKEN)).toEqual({ status: "gone" });
  });

  it("сохранённый subject: берётся из артефакта, профиль не нужен", async () => {
    const { repo } = makeRepo(
      makeRow({
        profile: null,
        subject: {
          username: "nasa",
          displayName: "NASA Official",
          avatarUrl: "https://blob.example/a.webp",
        },
      }),
    );
    const result = await readArtifact({ repo }, SLUG);
    expect(result.status === "found" && result.artifact.subject).toEqual({
      username: "nasa",
      displayName: "NASA Official",
      avatarUrl: "https://blob.example/a.webp",
    });
  });

  it("сохранённый subject с не-https аватаром: аватар null", async () => {
    const { repo } = makeRepo(
      makeRow({ subject: { username: "nasa", displayName: "NASA", avatarUrl: "data:x" } }),
    );
    const result = await readArtifact({ repo }, SLUG);
    expect(result.status === "found" && result.artifact.subject.avatarUrl).toBeNull();
  });

  it("subject = null (старая строка): запасной путь через профиль", async () => {
    const { repo } = makeRepo(makeRow({ subject: null }));
    const result = await readArtifact({ repo }, SLUG);
    expect(result.status === "found" && result.artifact.subject.displayName).toBe("NASA");
  });

  it("строку проверки профиля удалили: ник из генерации, аватара нет", async () => {
    const { repo } = makeRepo(makeRow({ profile: null }));
    const result = await readArtifact({ repo }, SLUG);
    expect(result.status === "found" && result.artifact.subject).toEqual({
      username: "nasa",
      displayName: "nasa",
      avatarUrl: null,
    });
  });

  it("не-https аватар и картинки отбрасываются", async () => {
    const { repo } = makeRepo(
      makeRow({
        profile: {
          username: "nasa",
          displayName: "NASA",
          avatarUrl: "javascript:alert(1)",
          postsCount: 1,
        },
        images: [
          { role: "hero", url: "data:text/html,<script>1</script>", alt: "x" },
          { role: "section", url: "https://blob.example/art/a/1.webp", alt: "ok" },
        ],
      }),
    );
    const result = await readArtifact({ repo }, SLUG);
    if (result.status !== "found") throw new Error("ожидали found");
    expect(result.artifact.subject.avatarUrl).toBeNull();
    expect(result.artifact.images.map((i) => i.url)).toEqual(["https://blob.example/art/a/1.webp"]);
  });

  it("битая строка: ArtifactCorruptError", async () => {
    const { repo } = makeRepo(makeRow({ content: { title: "" } }));
    await expect(readArtifact({ repo }, SLUG)).rejects.toMatchObject({
      name: "ArtifactCorruptError",
    });
  });

  it("лишние поля строки в ответ не попадают", () => {
    const row = {
      ...makeRow(),
      jokeCardId: "secret",
      rawProfile: { bio: "private" },
      content: { ...(makeRow().content as object), jokeCardId: "secret" },
    } as ArtifactReadRow;
    const json = JSON.stringify(toArtifact(row, false));
    expect(json).not.toContain("secret");
    expect(json).not.toContain("private");
    expect(json).not.toContain(row.ownerTokenHash);
    expect(json).not.toContain("ownerTokenHash");
  });

  it("текст с HTML отдаётся как данные, без изменений (экранирует React на FE)", async () => {
    const { repo } = makeRepo(makeRow());
    const result = await readArtifact({ repo }, SLUG);
    expect(result.status === "found" && result.artifact.kind === "roast_v1").toBe(true);
    if (result.status === "found" && result.artifact.kind === "roast_v1") {
      expect(result.artifact.content.punches[0]?.text).toBe("Первая <b>шутка</b>");
    }
  });
});

describe("getArtifactResponse", () => {
  it("200: Artifact, private no-cache + Vary: Cookie", async () => {
    const { repo } = makeRepo(makeRow());
    const res = await getArtifactResponse(req(TOKEN), SLUG, { repo });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("vary")).toBe("Cookie");
    const body = Artifact.parse(await res.json());
    expect(body.isOwner).toBe(true);
    expect(Object.keys(body)).not.toContain("ownerTokenHash");
  });

  it("404 для невалидного и несуществующего slug одинаковый", async () => {
    const missing = await getArtifactResponse(req(), SLUG, makeRepo(null));
    const invalid = await getArtifactResponse(req(), "bad", makeRepo(makeRow()));
    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(404);
    expect(await missing.text()).toBe(await invalid.text());
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });

  it("410 для удалённого, no-store", async () => {
    const res = await getArtifactResponse(
      req(),
      SLUG,
      makeRepo(makeRow({ deletedAt: new Date() })),
    );
    expect(res.status).toBe(410);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ errorCode: "internal" });
  });

  it("сбой БД: 500 без деталей, в лог только имя ошибки", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = {
      findBySlug: vi.fn(async () => {
        throw new Error("password=hunter2 host=db");
      }),
    };
    const res = await getArtifactResponse(req(), SLUG, { repo });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ errorCode: "internal" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("hunter2");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
