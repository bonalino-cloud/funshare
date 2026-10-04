import { describe, expect, it, vi } from "vitest";
import {
  COVER_MAX_BYTES,
  createCoverFetcher,
  downloadCover,
  isAllowedCoverUrl,
  sniffImageType,
  type FetchLike,
} from "./cover-fetch";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const GOOD = "https://scontent-fra5-1.cdninstagram.com/v/t51/a.jpg?x=1";

function reply(
  bytes: number[] | Uint8Array,
  init: { status?: number; type?: string | null; length?: string } = {},
) {
  const headers = new Headers();
  const type = init.type === undefined ? "image/jpeg" : init.type;
  if (type) headers.set("content-type", type);
  if (init.length) headers.set("content-length", init.length);
  return new Response(new Uint8Array(bytes), { status: init.status ?? 200, headers });
}

describe("isAllowedCoverUrl", () => {
  it.each([
    "https://scontent.cdninstagram.com/a.jpg",
    "https://scontent-fra5-1.xx.fbcdn.net/v/a.jpg?oh=1",
    "https://SCONTENT.FBCDN.NET/a.jpg",
  ])("пропускает %s", (url) => expect(isAllowedCoverUrl(url)).toBe(true));

  it.each([
    "https://evilfbcdn.net/a.jpg",
    "https://fbcdn.net.evil.com/a.jpg",
    "https://fbcdn.net/a.jpg", // голый домен: только поддомены
    "https://x.fbcdn.net.attacker.io/a.jpg",
    "http://scontent.fbcdn.net/a.jpg",
    "https://user:pass@scontent.fbcdn.net/a.jpg",
    "https://user@scontent.fbcdn.net/a.jpg",
    "https://scontent.fbcdn.net:8443/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a.jpg",
    "https://localhost/a.jpg",
    "https://scontent.fbcdn.net./a.jpg",
    "data:image/png;base64,AAAA",
    "file:///etc/passwd",
    "не url",
    "",
  ])("отклоняет %s", (url) => expect(isAllowedCoverUrl(url)).toBe(false));
});

describe("sniffImageType", () => {
  it("узнаёт форматы по сигнатуре", () => {
    expect(sniffImageType(new Uint8Array(JPEG))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array(PNG))).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("GIF89a.."))).toBe("image/gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("downloadCover", () => {
  it("успех: байты и mediaType из сигнатуры, без куки и чужих заголовков", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reply(PNG, { type: "image/jpeg" }));
    const result = await downloadCover(GOOD, { fetchImpl });
    expect(result?.mediaType).toBe("image/png"); // сигнатура важнее заголовка
    expect(Array.from(result!.data)).toEqual(PNG);
    const init = fetchImpl.mock.calls[0]![1];
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(["accept"]);
  });

  it("чужой хост: в сеть не ходит", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reply(JPEG));
    expect(await downloadCover("https://evilfbcdn.net/a.jpg", { fetchImpl })).toBeNull();
    expect(await downloadCover("http://a.fbcdn.net/a.jpg", { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("редирект (в том числе на чужой хост) не следуется", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    );
    expect(await downloadCover(GOOD, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("не 200 → null", async () => {
    expect(
      await downloadCover(GOOD, { fetchImpl: async () => reply(JPEG, { status: 404 }) }),
    ).toBeNull();
  });

  it.each(["text/html", "image/svg+xml", "application/octet-stream", null])(
    "неверный content-type %s → null",
    async (type) => {
      expect(
        await downloadCover(GOOD, { fetchImpl: async () => reply(JPEG, { type }) }),
      ).toBeNull();
    },
  );

  it("content-type с параметрами допустим", async () => {
    const fetchImpl = async () => reply(JPEG, { type: "Image/JPEG; charset=binary" });
    expect(await downloadCover(GOOD, { fetchImpl })).not.toBeNull();
  });

  it("файл не картинка при верном заголовке → null", async () => {
    const html = new TextEncoder().encode("<html>boom</html>");
    expect(await downloadCover(GOOD, { fetchImpl: async () => reply(html) })).toBeNull();
  });

  it("размер по content-length больше лимита → null, тело не читается", async () => {
    const response = reply(JPEG, { length: String(COVER_MAX_BYTES + 1) });
    const cancel = vi.spyOn(response.body!, "cancel");
    expect(await downloadCover(GOOD, { fetchImpl: async () => response })).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it("размер по факту потока (заголовок врёт или его нет) → обрыв чтения", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(40).fill(0xff));
        if (pulled > 1000) controller.close();
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "10" },
    });
    expect(
      await downloadCover(GOOD, { fetchImpl: async () => response, maxBytes: 100 }),
    ).toBeNull();
    expect(pulled).toBeLessThan(10); // читали до превышения, а не всё подряд
  });

  it("ровно на лимите допустимо", async () => {
    const bytes = new Uint8Array(100).fill(1);
    bytes.set(JPEG);
    expect(
      await downloadCover(GOOD, { fetchImpl: async () => reply(bytes), maxBytes: 100 }),
    ).not.toBeNull();
  });

  it("таймаут (сервер молчит) → null", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
      });
    expect(await downloadCover(GOOD, { fetchImpl, timeoutMs: 20 })).toBeNull();
  });

  it("таймаут при зависшем теле → null", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const fetchImpl: FetchLike = async (_url, init) => {
      const response = new Response(stream, { headers: { "content-type": "image/jpeg" } });
      init.signal!.addEventListener("abort", () => void stream.cancel().catch(() => {}));
      return response;
    };
    expect(await downloadCover(GOOD, { fetchImpl, timeoutMs: 20 })).toBeNull();
  });

  it("таймаут сработал до чтения тела (тело висит) → null, не зависает", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const fetchImpl: FetchLike = () =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve(new Response(stream, { headers: { "content-type": "image/jpeg" } })),
          40,
        ),
      );
    expect(await downloadCover(GOOD, { fetchImpl, timeoutMs: 10 })).toBeNull();
  });

  it("сетевая ошибка → null, не исключение", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await downloadCover(GOOD, { fetchImpl })).toBeNull();
  });
});

describe("createCoverFetcher", () => {
  it("частичный успех: пропущенные не сдвигают index остальных", async () => {
    const covers = [
      { index: 4, url: "https://a.fbcdn.net/4.jpg" },
      { index: 1, url: "https://evilfbcdn.net/1.jpg" },
      { index: 7, url: "https://b.cdninstagram.com/7.jpg" },
    ];
    const fetchImpl: FetchLike = async (url) =>
      url.includes("/7.") ? reply(JPEG, { status: 403 }) : reply(JPEG);
    const result = await createCoverFetcher({ fetchImpl })(covers);
    expect(result.map((c) => c.index)).toEqual([4]);
    expect(result[0]!.url).toBe(covers[0]!.url);
  });

  it("2 из 3, порядок сохраняется", async () => {
    const covers = [1, 3, 5].map((index) => ({ index, url: `https://a.fbcdn.net/${index}.jpg` }));
    const fetchImpl: FetchLike = async (url) =>
      url.includes("/3.") ? reply(JPEG, { type: "text/html" }) : reply(JPEG);
    const result = await createCoverFetcher({ fetchImpl })(covers);
    expect(result.map((c) => c.index)).toEqual([1, 5]);
  });

  it("причины отказов — в лог счётчиками, без URL", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const covers = [
      { index: 0, url: "https://evil.example.com/0.jpg" },
      { index: 1, url: "https://a.fbcdn.net/1.jpg" },
      { index: 2, url: "https://a.fbcdn.net/2.jpg" },
    ];
    const fetchImpl: FetchLike = async () => reply(JPEG, { status: 403 });
    await createCoverFetcher({ fetchImpl })(covers);
    const logged = log.mock.calls.flat().join(" ");
    log.mockRestore();
    expect(logged).toContain("host=1");
    expect(logged).toContain("status=2");
    expect(logged).not.toContain("fbcdn");
    expect(logged).not.toContain("evil");
  });

  it("не 200: тело ответа отменяется, соединение не висит", async () => {
    const response = reply(JPEG, { status: 404 });
    const cancel = vi.spyOn(response.body!, "cancel");
    expect(await downloadCover(GOOD, { fetchImpl: async () => response })).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it("ни одной → пустой список", async () => {
    const fetchImpl: FetchLike = async () => reply(JPEG, { status: 500 });
    const covers = [{ index: 0, url: "https://a.fbcdn.net/0.jpg" }];
    expect(await createCoverFetcher({ fetchImpl })(covers)).toEqual([]);
  });

  it("качает параллельно: зависшая обложка не складывается с остальными", async () => {
    const fetchImpl: FetchLike = (url, init) =>
      url.includes("/0.")
        ? new Promise((_r, reject) =>
            init.signal!.addEventListener("abort", () => reject(new Error("x"))),
          )
        : Promise.resolve(reply(JPEG));
    const covers = [0, 1, 2].map((index) => ({ index, url: `https://a.fbcdn.net/${index}.jpg` }));
    const started = Date.now();
    const result = await createCoverFetcher({ fetchImpl, timeoutMs: 50 })(covers);
    expect(result.map((c) => c.index)).toEqual([1, 2]);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
