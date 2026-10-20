import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOurAvatarUrl } from "./avatar";
import { discardMinorAvatar } from "./minor";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const OURS = "https://store1.public.blob.vercel-storage.com/avatars/abc";

describe("isOurAvatarUrl", () => {
  it.each([
    [OURS, true],
    ["https://store1.public.blob.vercel-storage.com/other/abc", false],
    ["https://evil.com/avatars/abc", false],
    ["https://public.blob.vercel-storage.com.evil.com/avatars/abc", false],
    ["http://store1.public.blob.vercel-storage.com/avatars/abc", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
    [null, false],
  ])("%j -> %j", (url, expected) => expect(isOurAvatarUrl(url)).toBe(expected));
});

describe("discardMinorAvatar", () => {
  const make = () => ({
    removeAvatar: vi.fn(async () => {}),
    repo: { clearAvatar: vi.fn(async () => {}) },
  });

  it("удаляет файл из Blob и обнуляет ссылку во всех проверках ника", async () => {
    const deps = make();
    await discardMinorAvatar(deps, "anya", OURS);
    expect(deps.removeAvatar).toHaveBeenCalledExactlyOnceWith(OURS);
    expect(deps.repo.clearAvatar).toHaveBeenCalledExactlyOnceWith("anya");
  });

  it("аватара нет: Blob не трогаем, ссылки всё равно чистим", async () => {
    const deps = make();
    await discardMinorAvatar(deps, "anya", null);
    expect(deps.removeAvatar).not.toHaveBeenCalled();
    expect(deps.repo.clearAvatar).toHaveBeenCalledOnce();
  });

  it("чужой URL из jsonb не уходит на удаление", async () => {
    const deps = make();
    await discardMinorAvatar(deps, "anya", "https://evil.com/avatars/abc");
    expect(deps.removeAvatar).not.toHaveBeenCalled();
  });

  it("Blob упал: ссылка остаётся для повторной чистки, исключения нет, в логе нет ника и URL", async () => {
    const deps = make();
    const error = new Error(`${OURS} anya`);
    error.name = "BlobError";
    deps.removeAvatar.mockRejectedValue(error);
    await expect(discardMinorAvatar(deps, "anya", OURS)).resolves.toBeUndefined();
    expect(deps.repo.clearAvatar).not.toHaveBeenCalled();
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("BlobError");
    expect(logged).not.toContain("anya");
    expect(logged).not.toContain("blob.vercel");
  });
});
