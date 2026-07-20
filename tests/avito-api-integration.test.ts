import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAvitoTokenCacheForTests,
  fetchAvitoItemImage,
  findFirstImageUrl,
  isLikelyImageUrl,
} from "@/lib/avito/api";
import {
  formatProductImageImportError,
  pickAvitoImage,
  resolveProductImage,
} from "@/lib/avito/fetch-image";

// Простой мок fetch с очередью ответов
function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () =>
        typeof r.body === "string" ? r.body : JSON.stringify(r.body),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

beforeEach(() => {
  __resetAvitoTokenCacheForTests();
  process.env.AVITO_CLIENT_ID = "test_id";
  process.env.AVITO_CLIENT_SECRET = "test_secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isLikelyImageUrl", () => {
  it("матчит обычные URL с расширением", () => {
    expect(isLikelyImageUrl("https://cdn.example.com/photo.jpg")).toBe(true);
    expect(isLikelyImageUrl("https://x.com/p.png?v=1")).toBe(true);
    expect(isLikelyImageUrl("https://x.com/p.webp#anchor")).toBe(true);
    expect(isLikelyImageUrl("http://x.com/a.jpeg")).toBe(true);
  });

  it("матчит Avito CDN даже без расширения", () => {
    expect(isLikelyImageUrl("https://01.avito.st/image/12345/full")).toBe(true);
    expect(isLikelyImageUrl("https://70.img.avito.st/image/1/1.abcd123")).toBe(true);
    expect(isLikelyImageUrl("https://04.avito.st/stat/photo/abc")).toBe(true);
  });

  it("не принимает служебные assets Avito за фото объявления", () => {
    expect(isLikelyImageUrl("https://www.avito.st/dstatic/build/client/ru-RU/fingerprint")).toBe(false);
  });

  it("не матчит произвольные строки и не-http URL", () => {
    expect(isLikelyImageUrl("not a url")).toBe(false);
    expect(isLikelyImageUrl("ftp://x.com/a.jpg")).toBe(false);
    expect(isLikelyImageUrl("https://example.com/page.html")).toBe(false);
  });
});

describe("formatProductImageImportError", () => {
  it("hides technical HTML abort details from order forms", () => {
    expect(
      formatProductImageImportError(
        "HTML: HTML scrape error: fetch failed: Request was cancelled. | API: no photo | BOTV: no photo",
      ),
    ).toBe("Фото не найдено. Добавьте фото вручную или повторите импорт позже.");
  });
});

describe("findFirstImageUrl — обход реальных структур Avito", () => {
  it("находит фото в массиве images по разным разрешениям", () => {
    const sample = {
      id: 12345,
      title: "Чехол",
      images: [
        {
          "1280x960": "https://40.avito.st/image/640/12345.jpg",
          "640x480": "https://40.avito.st/image/640/12345_small.jpg",
        },
      ],
    };
    const found = findFirstImageUrl(sample);
    expect(found).toMatch(/avito\.st/);
    expect(found).toMatch(/\.jpg$/);
  });

  it("находит фото когда images — объект, а не массив", () => {
    const sample = {
      images: {
        main: { "1280x960": "https://04.avito.st/image/main.jpg" },
        list: [{ "640x480": "https://04.avito.st/image/list.jpg" }],
      },
    };
    expect(findFirstImageUrl(sample)).toBe(
      "https://04.avito.st/image/main.jpg"
    );
  });

  it("находит фото в вложенном resources[0].images", () => {
    const sample = {
      resources: [
        {
          id: 1,
          images: [{ "640x480": "https://avito.st/cdn/r/1.png" }],
        },
      ],
    };
    expect(findFirstImageUrl(sample)).toBe(
      "https://avito.st/cdn/r/1.png"
    );
  });

  it("находит Avito CDN URL без расширения в API-ответе", () => {
    const sample = {
      images: [
        {
          url: "https://70.img.avito.st/image/1/1.abcd123",
        },
      ],
    };
    expect(findFirstImageUrl(sample)).toBe("https://70.img.avito.st/image/1/1.abcd123");
  });

  it("возвращает null если в структуре нет картинок", () => {
    expect(findFirstImageUrl({ id: 1, title: "no images" })).toBeNull();
    expect(findFirstImageUrl(null)).toBeNull();
    expect(findFirstImageUrl([])).toBeNull();
  });

  it("игнорирует не-image строки", () => {
    expect(
      findFirstImageUrl({
        title: "https://example.com/article.html",
        link: "https://avito.ru/item/123",
      })
    ).toBeNull();
  });
});

describe("pickAvitoImage — HTML Avito", () => {
  it("берёт img.avito.st URL без расширения из src", () => {
    expect(
      pickAvitoImage('<img src="https://70.img.avito.st/image/1/1.abcd123">')
    ).toBe("https://70.img.avito.st/image/1/1.abcd123");
  });

  it("берёт первое фото из srcset", () => {
    expect(
      pickAvitoImage('<source srcset="https://10.img.avito.st/image/1/1.small 1x, https://10.img.avito.st/image/1/1.large 2x">')
    ).toBe("https://10.img.avito.st/image/1/1.small");
  });

  it("понимает escaped URL из JSON на странице", () => {
    expect(
      pickAvitoImage('{"url":"https:\\/\\/40.img.avito.st\\/image\\/1\\/1.jsonpic"}')
    ).toBe("https://40.img.avito.st/image/1/1.jsonpic");
  });

  it("не возвращает иконки и логотипы вместо фото товара", () => {
    expect(
      pickAvitoImage('<link rel="icon" href="https://www.avito.st/icons/favicon.ico"><img src="https://20.img.avito.st/image/1/1.realpic">')
    ).toBe("https://20.img.avito.st/image/1/1.realpic");
  });

  it("пропускает служебные avito.st assets и берёт фото объявления", () => {
    expect(
      pickAvitoImage('<script src="https://www.avito.st/dstatic/build/client/ru-RU/fingerprint"></script><img src="https://30.img.avito.st/image/1/1.realpic">')
    ).toBe("https://30.img.avito.st/image/1/1.realpic");
  });
});

describe("fetchAvitoItemImage — реальный сценарий", () => {
  it("успех: токен → API → нашли картинку", async () => {
    const { fetchMock, calls } = mockFetchSequence([
      { status: 200, body: { access_token: "abc", expires_in: 3600 } },
      {
        status: 200,
        body: {
          id: 99,
          title: "X",
          images: [{ "1280x960": "https://40.avito.st/image/99.jpg" }],
        },
      },
    ]);

    const r = await fetchAvitoItemImage("99");
    expect(r).toEqual({
      ok: true,
      value: "https://40.avito.st/image/99.jpg",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0].url).toContain("api.avito.ru/token");
    expect(calls[1].url).toContain("/core/v1/items/99");
    expect(
      (calls[1].init?.headers as Record<string, string>).Authorization
    ).toBe("Bearer abc");
  });

  it("без credentials — внятная ошибка", async () => {
    delete process.env.AVITO_CLIENT_ID;
    const r = await fetchAvitoItemImage("99");
    expect(r).toEqual({
      ok: false,
      reason: "Avito credentials не настроены",
    });
  });

  it("токен 401 — возвращает ошибку с кодом", async () => {
    mockFetchSequence([{ status: 401, body: "invalid_client" }]);
    const r = await fetchAvitoItemImage("99");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Avito auth HTTP 401");
  });

  it("первый endpoint 404 — пробует следующий", async () => {
    mockFetchSequence([
      { status: 200, body: { access_token: "abc", expires_in: 3600 } },
      { status: 404, body: { error: "not found" } },
      {
        status: 200,
        body: { images: [{ "1280x960": "https://04.avito.st/img/99.jpg" }] },
      },
    ]);
    const r = await fetchAvitoItemImage("99");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("https://04.avito.st/img/99.jpg");
  });

  it("если короткие endpoint'ы 404 — лезет через accounts/self и /accounts/{id}/items/{id}", async () => {
    const { calls } = mockFetchSequence([
      // token
      { status: 200, body: { access_token: "abc", expires_in: 3600 } },
      // 2 коротких items endpoint падают
      { status: 404, body: "" },
      { status: 404, body: "" },
      // accounts/self отдаёт user_id
      { status: 200, body: { id: 12345 } },
      // /accounts/{id}/items/{itemId}/ возвращает картинку
      {
        status: 200,
        body: { images: [{ "1280x960": "https://04.avito.st/account/99.jpg" }] },
      },
    ]);
    const r = await fetchAvitoItemImage("99");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("https://04.avito.st/account/99.jpg");
    expect(calls.some((c) => c.url.includes("/accounts/self"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/accounts/12345/items/99"))).toBe(true);
  });

  it("все endpoints 404 — возвращает HTTP 404 как причину", async () => {
    mockFetchSequence([
      { status: 200, body: { access_token: "abc", expires_in: 3600 } },
      { status: 404, body: "" },
      { status: 404, body: "" },
      // accounts/self
      { status: 200, body: { id: 12345 } },
      { status: 404, body: "" },
      { status: 404, body: "" },
    ]);
    const r = await fetchAvitoItemImage("99");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Avito API HTTP 404");
  });

  it("API ответил 200 без картинок — внятная причина", async () => {
    mockFetchSequence([
      { status: 200, body: { access_token: "abc", expires_in: 3600 } },
      { status: 200, body: { id: 99, title: "no img" } },
      { status: 200, body: { id: 99, title: "no img" } },
      { status: 200, body: { id: 12345 } },
      { status: 200, body: { id: 99, title: "no img" } },
      { status: 200, body: { id: 99, title: "no img" } },
    ]);
    const r = await fetchAvitoItemImage("99");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("В ответе Avito нет фото");
  });

  it("токен кешируется между вызовами", async () => {
    const { fetchMock } = mockFetchSequence([
      { status: 200, body: { access_token: "abc", expires_in: 3600 } },
      { status: 200, body: { images: [{ url: "https://x.avito.st/1.jpg" }] } },
      { status: 200, body: { images: [{ url: "https://x.avito.st/2.jpg" }] } },
    ]);
    await fetchAvitoItemImage("1");
    await fetchAvitoItemImage("2");
    // 1 раз токен + 2 раза items = 3 вызова (не 4)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("resolveProductImage — единая точка входа", () => {
  it("если нет ни avitoItemId, ни URL — внятная причина", async () => {
    const r = await resolveProductImage({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("нет avitoItemId");
      expect(r.reason).toContain("нет avitoListingUrl");
    }
  });

  it("если API упал, но HTML работает — берёт из HTML", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: `<html><meta property="og:image" content="https://04.avito.st/page.jpg"></html>`,
      },
      // 1. Token
      { status: 200, body: { access_token: "abc", expires_in: 3600 } },
      // 2-3. Короткие API endpoint падают 404
      { status: 404, body: "" },
      { status: 404, body: "" },
      // 4. accounts/self возвращает user_id
      { status: 200, body: { id: 12345 } },
      // 5-6. Оба endpoint с account_id тоже 404
      { status: 404, body: "" },
      { status: 404, body: "" },
      // 7. HTML скрейп возвращает страницу с og:image
      {
        status: 200,
        body: `<html><meta property="og:image" content="https://04.avito.st/page.jpg"></html>`,
      },
    ]);
    const r = await resolveProductImage({
      avitoItemId: "99",
      avitoListingUrl: "https://www.avito.ru/item/99",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("https://04.avito.st/page.jpg");
  });

  it("если и API, и HTML провалились — детальная причина", async () => {
    mockFetchSequence([
      { status: 200, body: { access_token: "abc", expires_in: 3600 } },
      { status: 404, body: "" },
      { status: 404, body: "" },
      { status: 200, body: { id: 12345 } },
      { status: 404, body: "" },
      { status: 404, body: "" },
      { status: 403, body: "captcha" },
    ]);
    const r = await resolveProductImage({
      avitoItemId: "99",
      avitoListingUrl: "https://www.avito.ru/item/99",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("API:");
      expect(r.reason).toContain("HTML:");
    }
  });
});
