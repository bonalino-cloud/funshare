import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.hoisted(() =>
  vi.fn<(key: string, body: string, opts: object) => Promise<object>>(async () => ({})),
);
vi.mock("@vercel/blob", () => ({ put }));

import { putRawBlob, rawBlobToken } from "./blob";

beforeEach(() => put.mockClear());

describe("putRawBlob", () => {
  it("передаёт токен приватного store и private-доступ", async () => {
    await putRawBlob("raw/u/k.json", "{}", { BLOB_RAW_READ_WRITE_TOKEN: "raw-tok" });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(
      "raw/u/k.json",
      "{}",
      expect.objectContaining({ token: "raw-tok", access: "private" }),
    );
  });

  it("без токена — ошибка, put не вызывается, публичный токен не подставляется", async () => {
    await expect(
      putRawBlob("raw/u/k.json", "{}", { BLOB_READ_WRITE_TOKEN: "public-tok" }),
    ).rejects.toThrow(/BLOB_RAW_READ_WRITE_TOKEN/);
    expect(put).not.toHaveBeenCalled();
  });

  it("у ошибки говорящее name: лог скрейпа пишет только его", async () => {
    const err = await putRawBlob("k", "{}", {}).catch((e: Error) => e);
    expect((err as Error).name).toBe("RawBlobTokenMissing");
  });

  it("пустая строка = не задано", async () => {
    await expect(
      putRawBlob("raw/u/k.json", "{}", { BLOB_RAW_READ_WRITE_TOKEN: "" }),
    ).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("ошибка не содержит значений секретов", async () => {
    const err = await putRawBlob("k", "{}", { BLOB_READ_WRITE_TOKEN: "public-tok" }).catch(
      (e: Error) => e,
    );
    expect((err as Error).message).not.toContain("public-tok");
  });
});

describe("rawBlobToken", () => {
  it("возвращает только приватный токен, публичный игнорирует", () => {
    expect(
      rawBlobToken({ BLOB_RAW_READ_WRITE_TOKEN: "raw-tok", BLOB_READ_WRITE_TOKEN: "public-tok" }),
    ).toBe("raw-tok");
    expect(() => rawBlobToken({ BLOB_READ_WRITE_TOKEN: "public-tok" })).toThrow();
  });
});
