import type { Browser, Page } from "playwright";

export const MARKET_SOURCES = ["grailed", "mercari", "rakuma"] as const;
export type MarketSource = (typeof MARKET_SOURCES)[number];

export type MarketListing = {
  source: MarketSource;
  title: string;
  url: string;
  price?: string;
  imageUrl?: string;
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
  listingSelector: string;
  useReader?: boolean;
  searchUrl: (query: string) => string;
}> = {
  grailed: {
    searchOrigin: "https://www.grailed.com",
    listingOrigins: ["https://www.grailed.com"],
    listingPath: /^\/listings\//,
    listingSelector: "a[href*='/listings/']",
    searchUrl: (query) => `https://www.grailed.com/shop?query=${encodeURIComponent(query)}&sort=heat`,
  },
  mercari: {
    searchOrigin: "https://jp.mercari.com",
    listingOrigins: ["https://jp.mercari.com"],
    listingPath: /^\/item\//,
    listingSelector: "a[href*='/item/']",
    searchUrl: (query) => `https://jp.mercari.com/search?keyword=${encodeURIComponent(query)}&sort=num_likes&order=desc`,
  },
  rakuma: {
    searchOrigin: "https://fril.jp",
    listingOrigins: ["https://item.fril.jp"],
    listingPath: /^\/[a-z0-9]+\/?$/,
    listingSelector: "a[href*='item.fril.jp']",
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
  [/\bskull\b|スカル/i, "distressed skull illustration"],
  [/\b(?:spider|web)\b/i, "web-like linework"],
  [/\b(?:message|slogan|logo)\b/i, "distressed message-shirt hierarchy"],
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
      return await collectSource(page, source, marketSearchQuery(source, normalizedQuery), limitPerSource);
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

export function buildOriginalDesignPrompt(
  research: MarketResearch,
  designNote?: string,
  labelStyleReference?: string,
  referenceCount = 1,
): string {
  const signals = research.topSignals.length
    ? research.topSignals.join(", ")
    : "asymmetric archive-fashion layout, controlled negative space, layered print rhythm, restrained vintage distressing";
  const note = designNote?.replace(/\s+/g, " ").trim().slice(0, 180);
  const labelHint = labelStyleReference?.replace(/\s+/g, " ").trim().slice(0, 60);
  const evidence = research.listings.slice(0, 15)
    .map((listing) => `${listing.source}: ${listing.title}${listing.price ? ` (${listing.price})` : ""}`)
    .join("; ");
  const isLgb = /(?:^|\W)(?:l\.?g\.?b\.?|le grande bleu)(?:\W|$)/i.test(research.query);
  const typographyEvidence = [
    ...research.listings.map((listing) => listing.title),
    ...research.topSignals,
  ].filter((value) => /message|poem|quote|typograph|letter|word|freedom|wind|manifesto|text|メッセージ|詩/i.test(value)).length;
  const typographyConcept = [
    "DEMAND-GROUNDED FALLBACK CONCEPT — AFTERTONE MANIFESTO.",
    "FRONT: an 11 x 17 cm narrow editorial composition built around the one exact original word AFTERTONE in condensed distressed italic capitals. Break the baseline into two offset registrations, add one hairline wine-red strike and a faint smoke-grey ghost impression. Keep at least 70% of the bounding area untouched black fabric. No box, badge, solid field, photo panel, skull, animal, star or generic logo.",
    "BACK: a 22 x 30 cm stacked message reading exactly STAY UNSEEN in tall eroded condensed capitals, interrupted by sparse thread-thin wine-red registration lines and dry grey halftone loss. The words remain readable and intentional while at least 55% of the bounding area is black negative space. No rectangle, background fill, mascot, skull, cross or copied brand wording.",
    "This is one original coordinated typography concept derived from the proven message-shirt, poem, WIND/FREEDOM and distressed Y2K hierarchy in the inspected marketplaces. It must feel like rare Japanese archive editorial merchandise, never a basic slogan tee or print-on-demand wordmark.",
  ].join(" ");
  const nightVeilConcept = [
    "DEMAND-GROUNDED FALLBACK CONCEPT — NIGHT VEIL.",
    "FRONT: a 12 x 16 cm isolated handmade cross assembled from four fractured bone-like strokes, loosely bound at the center by one thin wine-red thread. Sparse smoke-grey web-line fragments interrupt the silhouette. At least 75% of the bounding area remains untouched black shirt. No solid fill, cream field, box, badge, text, animal, star or background panel.",
    "BACK: a 22 x 30 cm vertical three-quarter human skull profile, visibly fractured and partly erased, caught in sparse broken spider-silk linework with one incomplete wine-red halo slash. Build it from separated bone-grey halftone fragments; at least 60% of the bounding area remains untouched black fabric. No spider body, solid light field, rectangle, photo panel, text, animal or fantasy ornament.",
    "This is one original coordinated concept derived from the proven cross, skull, web, message-shirt and distressed Y2K grammar in the inspected Grailed, Mercari and Rakuma listings; it must not copy any listed artwork or the winner's horse and stars.",
  ].join(" ");
  const fallbackConcept = isLgb
    ? typographyEvidence >= 2 ? typographyConcept : nightVeilConcept
    : "MARKET-GROUNDED FALLBACK: derive one original adjacent subject only from the concrete inspected listing evidence below; reject any subject with no visual or title support in at least two marketplaces.";
  return [
    "Create ONE premium, genuinely new designer-fashion garment and one photorealistic marketplace photo.",
    `IMAGES 1-${referenceCount} are views of the same proven garment: study its construction, front/back hierarchy, print scale, asymmetry, negative space and distressed ink, but do not copy or merely move its artwork.`,
    `IMAGE ${referenceCount + 1} is SCENE ONLY: copy only its real surface, camera, crop and light; ignore its garment, print, label, text and objects.`,
    `Build one coherent coordinated front-and-back graphic system informed by the actually inspected Grailed, Mercari and Rakuma listings (${signals}); it must feel like a collectible alternative-rockstar archive piece with swag, not print-on-demand clipart. The front is a restrained secondary hook and the back is the hero statement; never repeat the same principal object, figure, hand, face, symbol or silhouette on both sides.`,
    `ACTUAL MARKET EVIDENCE: ${evidence || "No credible listings were captured; do not invent an unrelated subject."}`,
    "PRODUCTION LOCK: every artwork must fit inside one flat printable rectangle no larger than 24 cm wide by 32 cm high. Keep at least 5 cm clear of collar, shoulder, sleeve, side and hem seams. No all-over print, tiled panels, wraparound artwork, sleeve print, seam crossing or edge-to-edge blocks.",
    "Use a specific, recognizable editorial subject with a coherent story and a restrained one-to-three-ink palette. Do not substitute random abstract squares, rectangles, grids, color fields or decorative geometry for an actual design idea.",
    fallbackConcept,
    "Do not reuse any recognizable winner subject, symbol, silhouette or composition—even if moved, resized, mirrored or redrawn. Explicitly exclude the winner's stars and horse/equine artwork. Use specific art direction, layered placement and deliberate visual tension.",
    "LABEL CONSTRUCTION LOCK: there are NO hang tags, paper tags, sewn labels or woven tabs. The only label is a heat-transfer marking printed inside the back-neck panel and hidden in exterior product views. Never generate visible label letters, L.G.B., a white locator, fastener, string or cropped tag fragment on the collar, chest or outer back.",
    "Real cotton weave, absorbed screen-print ink, sharp seams, natural folds and contact shadows; no CGI, pasted art, props, extra garments, watermarks, UI or fake text.",
    note ? `User direction: ${note}.` : "",
    labelHint ? `Label identification hint only: ${labelHint}.` : "",
    "Return only one sharp high-resolution final photo.",
  ].filter(Boolean).join(" ");
}

async function collectSource(page: Page, source: MarketSource, query: string, limit: number) {
  const config = sourceConfig[source];
  const searchUrl = config.searchUrl(query);
  await page.goto(config.useReader ? `https://r.jina.ai/${searchUrl}` : searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  if (!config.useReader) {
    await page.locator(config.listingSelector).first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(config.useReader ? 2_500 : 4_000);
  if (config.useReader) {
    const markdown = await page.locator("body").innerText();
    return parseReaderListings(markdown, source, config.listingOrigins, config.listingPath, limit);
  }
  const listings = await page.locator("a[href]").evaluateAll((anchors, input) => {
    const seen = new Set<string>();
    const results: Array<{ source: MarketSource; title: string; url: string; price?: string; imageUrl?: string }> = [];
    for (const anchor of anchors) {
      const href = (anchor as HTMLAnchorElement).getAttribute("href") || "";
      let url: URL;
      try {
        url = new URL(href, input.searchOrigin);
      } catch {
        continue;
      }
      if (!input.listingOrigins.includes(url.origin) || !new RegExp(input.listingPattern).test(url.pathname)) continue;
      url.search = "";
      if (seen.has(url.href)) continue;
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
      const imageUrl = image instanceof HTMLImageElement ? (image.currentSrc || image.src) : "";
      results.push({ source: input.source, title, url: url.href, ...(price ? { price } : {}), ...(imageUrl ? { imageUrl } : {}) });
      if (results.length >= input.limit) break;
    }
    return results;
  }, {
    source,
    searchOrigin: config.searchOrigin,
    listingOrigins: config.listingOrigins,
    listingPattern: config.listingPath.source,
    limit: Math.max(limit * 5, 30),
  });
  return rankListings(listings, query).slice(0, limit);
}

export function marketSearchQuery(source: MarketSource, query: string) {
  const compact = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const isLgb = compact.includes("lgb") || compact.includes("legrandbleu");
  if (!isLgb) return query;
  return source === "grailed" ? "L.G.B. graphic t-shirt" : "LGB Tシャツ";
}

function rankListings(listings: MarketListing[], query: string) {
  const compactQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const wantsLgb = compactQuery.includes("lgb") || compactQuery.includes("legrandbleu");
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !["archive", "shirt", "tshirt", "design", "tee", "long", "sleeve"].includes(token));
  return listings.map((listing, index) => {
    const title = listing.title.toLowerCase();
    const compactTitle = title.replace(/[^a-z0-9]+/g, "");
    let score = tokens.reduce((total, token) => total + (title.includes(token) ? 4 : 0), 0);
    if (wantsLgb && /le grande bleu|ルグランブルー/i.test(listing.title)) score += 40;
    else if (wantsLgb && compactTitle.includes("lgb")) score += 18;
    if (wantsLgb && /t[- ]?shirt|tee|shirt|Tシャツ|ロンT|カットソー/i.test(listing.title)) score += 18;
    if (wantsLgb && /cross|skull|spider|message|graphic|クロス|スカル/i.test(listing.title)) score += 8;
    if (wantsLgb && /denim|jeans|pants|cardigan|jacket|hoodie|デニム|パンツ|カーディガン|ジャケット|パーカー/i.test(listing.title)) score -= 18;
    if (wantsLgb && /lgb style|not lgb|burberry|topvalu|berning sho|hydrogen|fournine|hysteric glamour|14th addiction/i.test(listing.title)) score -= 60;
    return { listing, index, score };
  }).sort((left, right) => right.score - left.score || left.index - right.index).map(({ listing }) => listing);
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
