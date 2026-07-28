import type { Browser, Page } from "playwright";

export const MARKET_SOURCES = ["grailed", "mercari", "rakuma"] as const;
export type MarketSource = (typeof MARKET_SOURCES)[number];

export type MarketListing = {
  source: MarketSource;
  title: string;
  url: string;
  price?: string;
};

export type MarketResearch = {
  query: string;
  checkedAt: string;
  listings: MarketListing[];
  topSignals: string[];
  sourceCounts: Record<MarketSource, number>;
};

const sourceConfig: Record<MarketSource, {
  searchOrigin: string;
  listingOrigins: string[];
  listingPath: RegExp;
  useReader?: boolean;
  searchUrl: (query: string) => string;
}> = {
  grailed: {
    searchOrigin: "https://www.grailed.com",
    listingOrigins: ["https://www.grailed.com"],
    listingPath: /^\/listings\//,
    useReader: true,
    searchUrl: (query) => `https://www.grailed.com/shop?query=${encodeURIComponent(query)}`,
  },
  mercari: {
    searchOrigin: "https://www.mercari.com",
    listingOrigins: ["https://www.mercari.com"],
    listingPath: /^\/us\/item\//,
    useReader: true,
    searchUrl: (query) => `https://www.mercari.com/search/?keyword=${encodeURIComponent(query)}`,
  },
  rakuma: {
    searchOrigin: "https://fril.jp",
    listingOrigins: ["https://item.fril.jp"],
    listingPath: /^\/[a-z0-9]+\/?$/,
    searchUrl: (query) => `https://fril.jp/s?query=${encodeURIComponent(query)}`,
  },
};

const visualSignals: Array<[RegExp, string]> = [
  [/\bgoth(?:ic)?\b/i, "gothic mood"],
  [/\b(?:washed|faded|distressed|vintage)\b|ヴィンテージ/i, "vintage wash and distressing"],
  [/\b(?:y2k|2000s?)\b/i, "Y2K styling"],
  [/\b(?:tribal|tattoo)\b/i, "tribal linework"],
  [/\bgrunge\b/i, "grunge texture"],
  [/\bpatchwork\b/i, "patchwork construction"],
  [/\b(?:oversized|boxy)\b/i, "oversized proportions"],
  [/\b(?:cross|crucifix)\b/i, "cross-inspired geometry"],
  [/\b(?:spider|web)\b/i, "web-like linework"],
  [/\b(?:baroque|ornate)\b/i, "ornate framing"],
  [/\b(?:all over|aop|総柄)\b/i, "all-over print"],
  [/\b(?:front and back|double-sided)\b/i, "front-and-back graphics"],
  [/\b(?:longsleeve|long sleeve|long-sleeve)\b|長袖/i, "long-sleeve canvas"],
  [/\b(?:black|charcoal)\b|ブラック/i, "dark neutral base"],
  [/\b(?:burgundy|oxblood|red)\b/i, "deep red accent"],
  [/\b(?:silver|chrome|metallic)\b/i, "metallic accent"],
  [/\b(?:big print|large graphic|oversize print)\b/i, "large central graphic"],
];

export async function collectMarketResearch(browser: Browser, query: string, limitPerSource = 10): Promise<MarketResearch> {
  const normalizedQuery = query.trim().slice(0, 120);
  const settled = await Promise.all(MARKET_SOURCES.map(async (source) => {
    const page = await browser.newPage();
    try {
      return await collectSource(page, source, normalizedQuery, limitPerSource);
    } catch (error) {
      console.warn(`[flow-agent] ${source} research failed: ${error instanceof Error ? error.message : String(error)}`);
      return [] as MarketListing[];
    } finally {
      await page.close();
    }
  }));
  const listings = settled.flat();
  const sourceCounts = Object.fromEntries(MARKET_SOURCES.map((source) => [
    source,
    listings.filter((listing) => listing.source === source).length,
  ])) as Record<MarketSource, number>;
  return {
    query: normalizedQuery,
    checkedAt: new Date().toISOString(),
    listings,
    topSignals: findTopSignals(listings.map((listing) => listing.title)),
    sourceCounts,
  };
}

export function buildOriginalDesignPrompt(research: MarketResearch): string {
  const signals = research.topSignals.length
    ? research.topSignals.join(", ")
    : "strong central graphic, readable hierarchy, restrained vintage distressing";
  return [
    "Create exactly ONE original, commercially strong apparel design presented as a photorealistic marketplace product photo.",
    "REFERENCE IMAGE 1 is only the required background, perspective and lighting reference.",
    `Fresh marketplace research across Grailed, Mercari and Rakuma for '${research.query}' found these recurring signals: ${signals}.`,
    "Use the combined signals as abstract inspiration, not as source artwork.",
    "Create a genuinely new graphic concept with different composition, wording, symbols and illustration. Do not reproduce or closely imitate any identifiable print, character, logo, brand name, artist style, trademark or copyrighted artwork from the reference or marketplace listings.",
    "Create a visibly new central motif, supporting geometry and composition; do not reuse the winner's subject or silhouette.",
    "Keep the garment category and realistic construction believable. Preserve the background identity, perspective and light from REFERENCE IMAGE 1.",
    "Render premium commercial quality: crisp original print edges, visible cotton weave, realistic ink absorption, sharp seams, natural folds, contact shadows, neutral white balance and high micro-contrast.",
    "The result should feel sellable in the same audience while remaining clearly independent and original, sharp and high resolution.",
    "Use no words, letters, numbers, neck-label text or fake branding. No mockup labels, watermarks, UI, borders or explanatory text. Return only the final image.",
  ].join("\n");
}

async function collectSource(page: Page, source: MarketSource, query: string, limit: number) {
  const config = sourceConfig[source];
  const searchUrl = config.searchUrl(query);
  await page.goto(config.useReader ? `https://r.jina.ai/${searchUrl}` : searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(2_500);
  if (config.useReader) {
    const markdown = await page.locator("body").innerText();
    return parseReaderListings(markdown, source, config.listingOrigins, config.listingPath, limit);
  }
  return page.locator("a[href]").evaluateAll((anchors, input) => {
    const seen = new Set<string>();
    const results: Array<{ source: MarketSource; title: string; url: string; price?: string }> = [];
    for (const anchor of anchors) {
      const href = (anchor as HTMLAnchorElement).getAttribute("href") || "";
      let url: URL;
      try {
        url = new URL(href, input.searchOrigin);
      } catch {
        continue;
      }
      if (!input.listingOrigins.includes(url.origin) || !new RegExp(input.listingPattern).test(url.pathname) || seen.has(url.href)) continue;
      const card = anchor.closest("article, li, [data-testid*='item'], [class*='listing'], [class*='item'], [class*='product']") || anchor;
      const image = card.querySelector("img");
      const rawTitle = [
        image?.getAttribute("alt"),
        anchor.getAttribute("aria-label"),
        (card as HTMLElement).innerText,
      ].find((value) => value && value.trim().length >= 4) || "";
      const lines = rawTitle.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const title = lines.find((line) => !/^[¥$€£]\s?[\d,.]+/.test(line))?.slice(0, 180) || "";
      if (title.length < 4) continue;
      const price = lines.find((line) => /(?:^[¥$€£]\s?[\d,.]+)|(?:[\d,.]+\s?(?:USD|JPY|円)$)/i.test(line))?.slice(0, 40);
      seen.add(url.href);
      results.push({ source: input.source, title, url: url.href, ...(price ? { price } : {}) });
      if (results.length >= input.limit) break;
    }
    return results;
  }, {
    source,
    searchOrigin: config.searchOrigin,
    listingOrigins: config.listingOrigins,
    listingPattern: config.listingPath.source,
    limit,
  });
}

function parseReaderListings(
  markdown: string,
  source: MarketSource,
  listingOrigins: string[],
  listingPath: RegExp,
  limit: number,
) {
  const results: MarketListing[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split("\n")) {
    const urlMatch = line.match(/https:\/\/(?:www\.)?(?:grailed\.com|mercari\.com)\/[^)\s]+/i);
    if (!urlMatch) continue;
    let url: URL;
    try {
      url = new URL(urlMatch[0].replace(/[),.]+$/, ""));
    } catch {
      continue;
    }
    if (!listingOrigins.includes(url.origin) || !listingPath.test(url.pathname) || seen.has(url.href)) continue;
    const imageTitle = line.match(/!\[Image \d+:\s*([^\]]+)\]/i)?.[1];
    const slugTitle = decodeURIComponent(url.pathname.split("/").filter(Boolean).slice(2).join(" "))
      .replace(/^\d+\s*/, "")
      .replace(/-/g, " ");
    const title = (imageTitle || slugTitle).trim().slice(0, 180);
    if (title.length < 4) continue;
    const price = line.match(/[$€£¥]\s?[\d,.]+/)?.[0];
    url.search = "";
    seen.add(url.href);
    results.push({ source, title, url: url.href, ...(price ? { price } : {}) });
    if (results.length >= limit) break;
  }
  return results;
}

function findTopSignals(titles: string[]) {
  const counts = new Map<string, number>();
  for (const title of titles) {
    for (const [pattern, label] of visualSignals) {
      if (pattern.test(title)) counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([signal]) => signal);
}
