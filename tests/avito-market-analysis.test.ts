import { describe, expect, it } from "vitest";
import { buildAvitoSearchUrl, parseAvitoHtml } from "@/lib/avito/market-analysis";

describe("Avito public market probe", () => {
  it("builds a public search url from query and city slug", () => {
    expect(buildAvitoSearchUrl("футболки", "moskva")).toBe(
      "https://www.avito.ru/moskva?q=%D1%84%D1%83%D1%82%D0%B1%D0%BE%D0%BB%D0%BA%D0%B8",
    );
  });

  it("extracts ad id, views and listing links from public html", () => {
    const result = parseAvitoHtml(
      `
        <html>
          <head>
            <title>Футболка Nike - Авито</title>
            <script id="__NEXT_DATA__" type="application/json">{}</script>
          </head>
          <body>
            <a href="/moskva/odezhda/futbolka_nike_1234567890">item</a>
            <span>1 248 просмотров</span>
          </body>
        </html>
      `,
      {
        requestedUrl: "https://www.avito.ru/moskva/odezhda/futbolka_nike_1234567890",
        finalUrl: "https://www.avito.ru/moskva/odezhda/futbolka_nike_1234567890",
        status: 200,
        ok: true,
        contentType: "text/html",
      },
    );

    expect(result.pageType).toBe("ad");
    expect(result.itemId).toBe("1234567890");
    expect(result.views).toBe(1248);
    expect(result.signals.hasNextData).toBe(true);
    expect(result.listingPreviews[0]).toEqual({
      id: "1234567890",
      url: "https://www.avito.ru/moskva/odezhda/futbolka_nike_1234567890",
    });
  });
});
