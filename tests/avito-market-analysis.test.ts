import { describe, expect, it } from "vitest";
import { buildAvitoSearchUrl, parseAvitoHtml } from "@/lib/avito/market-analysis";

describe("Avito public market probe", () => {
  it("builds a public search url from category without city input", () => {
    expect(buildAvitoSearchUrl("футболки")).toBe(
      "https://www.avito.ru/rossiya?q=%D1%84%D1%83%D1%82%D0%B1%D0%BE%D0%BB%D0%BA%D0%B8&s=104",
    );
  });

  it("extracts listing links from public search html", () => {
    const result = parseAvitoHtml(
      `
        <html>
          <head>
            <title>Футболки - Авито</title>
            <script id="__NEXT_DATA__" type="application/json">{}</script>
          </head>
          <body>
            <a href="/moskva/odezhda/futbolka_nike_1234567890">item</a>
            <span>1 248 просмотров</span>
          </body>
        </html>
      `,
      {
        requestedUrl: "https://www.avito.ru/rossiya?q=футболки&s=104",
        finalUrl: "https://www.avito.ru/rossiya?q=футболки&s=104",
        status: 200,
        ok: true,
        contentType: "text/html",
        category: "футболки",
        periodDays: 3,
      },
    );

    expect(result.pageType).toBe("search");
    expect(result.itemId).toBeNull();
    expect(result.views).toBeNull();
    expect(result.signals.hasNextData).toBe(true);
    expect(result.listingPreviews[0]).toEqual({
      id: "1234567890",
      url: "https://www.avito.ru/moskva/odezhda/futbolka_nike_1234567890",
    });
  });
});
