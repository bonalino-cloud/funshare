import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AVATAR_MAX_BYTES,
  avatarBlobKey,
  createAvatarCopier,
  storePublic,
  type AvatarDeps,
} from "./avatar";

const { putMock } = vi.hoisted(() => ({ putMock: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: putMock }));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const IG_URL = "https://scontent-ams4-1.cdninstagram.com/v/t51/a.jpg?sig=1";
const OUR_URL = "https://blob.example.com/avatars/xyz";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(over: Partial<AvatarDeps> = {}) {
  const download = vi.fn<AvatarDeps["download"]>(async () => ({
    data: JPEG,
    mediaType: "image/jpeg",
  }));
  const store = vi.fn<AvatarDeps["store"]>(async () => OUR_URL);
  const copy = createAvatarCopier({ download, store, ...over });
  return { download, store, copy };
}

const logged = () => vi.mocked(console.error).mock.calls.flat().join(" ");

describe("createAvatarCopier", () => {
  it("успех: качает с лимитом и коротким таймаутом, кладёт по типу из байтов, отдаёт наш URL", async () => {
    const t = setup();
    await expect(t.copy({ username: "anya.travels", url: IG_URL })).resolves.toBe(OUR_URL);
    expect(t.download).toHaveBeenCalledWith(
      IG_URL,
      expect.objectContaining({ maxBytes: AVATAR_MAX_BYTES, timeoutMs: 4_000 }),
    );
    expect(t.store).toHaveBeenCalledWith(avatarBlobKey("anya.travels"), JPEG, "image/jpeg");
  });

  it("нет URL у профиля → null, ничего не качаем", async () => {
    const t = setup();
    await expect(t.copy({ username: "anya.travels", url: null })).resolves.toBeNull();
    expect(t.download).not.toHaveBeenCalled();
  });

  it("сбой скачивания → null, в Blob не пишем, в лог ни ника, ни URL", async () => {
    const t = setup({ download: vi.fn(async () => null) });
    await expect(t.copy({ username: "anya.travels", url: IG_URL })).resolves.toBeNull();
    expect(t.store).not.toHaveBeenCalled();
    expect(logged()).not.toContain("anya.travels");
    expect(logged()).not.toContain("cdninstagram");
  });

  it("сбой Blob → null, в лог только имя ошибки", async () => {
    const error = new Error(`PUT ${IG_URL} anya.travels`);
    error.name = "BlobAccessError";
    const t = setup({ store: vi.fn(async () => Promise.reject(error)) });
    await expect(t.copy({ username: "anya.travels", url: IG_URL })).resolves.toBeNull();
    expect(logged()).toContain("BlobAccessError");
    expect(logged()).not.toContain("anya.travels");
    expect(logged()).not.toContain("cdninstagram");
  });

  it("зависший Blob → null по общему таймауту", async () => {
    vi.useFakeTimers();
    const t = setup({ store: vi.fn(() => new Promise<string>(() => {})) });
    const result = t.copy({ username: "anya.travels", url: IG_URL });
    await vi.advanceTimersByTimeAsync(8_001);
    await expect(result).resolves.toBeNull();
  });

  describe("небезопасный URL: через боевой загрузчик не качаем (сети нет — fetch не вызывается)", () => {
    it.each([
      ["http (не https)", "http://scontent.cdninstagram.com/a.jpg"],
      ["чужой хост", "https://evil.example.com/a.jpg"],
      ["суффикс-обманка", "https://evilcdninstagram.com/a.jpg"],
      ["внутренний адрес", "https://169.254.169.254/latest/meta-data"],
      ["логин в URL", "https://user:pass@scontent.cdninstagram.com/a.jpg"],
      ["нестандартный порт", "https://scontent.cdninstagram.com:8443/a.jpg"],
      ["javascript:", "javascript:alert(1)"],
    ])("%s → null", async (_name, url) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { downloadCover } = await import("../analyze/cover-fetch");
      const store = vi.fn<AvatarDeps["store"]>(async () => OUR_URL);
      const copy = createAvatarCopier({ download: downloadCover, store });
      await expect(copy({ username: "anya.travels", url })).resolves.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(store).not.toHaveBeenCalled();
    });
  });
});

describe("avatarBlobKey", () => {
  it("детерминирован, без ника в открытом виде, без расширения", () => {
    const key = avatarBlobKey("anya.travels");
    expect(key).toBe(avatarBlobKey("anya.travels"));
    expect(key).not.toBe(avatarBlobKey("other.user"));
    expect(key).toMatch(/^avatars\/[0-9a-f]{32}$/);
    expect(key).not.toContain("anya");
  });
});

describe("storePublic", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("пишет в ПУБЛИЧНЫЙ store токеном BLOB_READ_WRITE_TOKEN, с типом по байтам", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "pub-tok");
    vi.stubEnv("BLOB_RAW_READ_WRITE_TOKEN", "raw-tok");
    putMock.mockResolvedValue({ url: OUR_URL });
    await expect(storePublic("avatars/k", JPEG, "image/jpeg")).resolves.toBe(OUR_URL);
    expect(putMock).toHaveBeenCalledWith(
      "avatars/k",
      expect.any(Buffer),
      expect.objectContaining({
        token: "pub-tok",
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: true,
      }),
    );
  });

  it("без публичного токена не откатывается на приватный", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_RAW_READ_WRITE_TOKEN", "raw-tok");
    putMock.mockClear();
    await expect(storePublic("avatars/k", JPEG, "image/jpeg")).rejects.toThrow(/BLOB_READ_WRITE/);
    expect(putMock).not.toHaveBeenCalled();
  });
});
