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
  const fallbackConcept = fallbackDesignConcept(note);
  return [
    "Create ONE premium, genuinely new designer-fashion garment and one photorealistic marketplace photo.",
    `IMAGES 1-${referenceCount} are views of the same proven garment: study its construction, front/back hierarchy, print scale, asymmetry, negative space and distressed ink, but do not copy or merely move its artwork.`,
    `IMAGE ${referenceCount + 1} is SCENE ONLY: copy only its real surface, camera, crop and light; ignore its garment, print, label, text and objects.`,
    `Build one coherent coordinated front-and-back graphic system informed by the actually inspected Grailed, Mercari and Rakuma listings (${signals}); it must feel like a collectible STROK SHOP piece, not print-on-demand clipart. Preserve the winner's actual commercial hierarchy: whichever side carries its hero should remain the hero side. The second side must be a distinct supporting composition, never a repeated, mirrored or enlarged copy of the same principal subject.`,
    `ACTUAL MARKET EVIDENCE: ${evidence || "No credible listings were captured; do not invent an unrelated subject."}`,
    "PRODUCTION LOCK: every artwork must fit inside one flat printable rectangle no larger than 24 cm wide by 32 cm high. Keep at least 5 cm clear of collar, shoulder, sleeve, side and hem seams. No all-over print, tiled panels, wraparound artwork, sleeve print, seam crossing or edge-to-edge blocks.",
    "Use one specific adult editorial subject and a coherent story with a restrained one-to-three-ink palette. Valid directions include an anonymous human/editorial photo crop, deliberate exact-text composition, nightlife-flyer or security-label layout, industrial hardware detail, cropped hands/statue fragments, or a distressed poster field only when that grammar is visibly supported. Do not substitute random abstract squares, rectangles, grids or decorative geometry for an actual design idea.",
    "ADULT STREETWEAR LOCK: make sharp trap/archive fashion, never children's or fantasy merch. No animals, birds, insects, owls, mascots, fantasy creatures, moon/zodiac/tarot imagery, cute faces or cartoons. A horse or other subject on a winner teaches scale and hierarchy only; never repeat it and never replace it with another creature.",
    "COMMERCIAL TASTE LOCK: no radial ring of repeated sticks, eye/oval/swoosh emblem, lone number over an abstract blob, tiny symbol centered on an otherwise blank side, esports/tech/sports identity, arbitrary geometric badge, invented two-word brand name, or motif salad. The design needs a clear subject, hierarchy and reason to exist at thumbnail size.",
    "If typography is used, specify exact short text with real correctly spelled words. Never ask Flow to improvise fake letters. Avoid holographic foil, glossy vinyl and synthetic 3D effects; use believable absorbed ink, halftone, overprint and controlled distress.",
    fallbackConcept,
    "Do not reuse any recognizable winner subject, symbol, silhouette or composition—even if moved, resized, mirrored or redrawn. Explicitly exclude the winner's stars and horse/equine artwork, plus every other animal or mascot. Use specific art direction, layered placement and deliberate visual tension.",
    "LABEL CONSTRUCTION LOCK: there are NO hang tags, paper tags, sewn labels or woven tabs. The only label is a heat-transfer marking printed inside the back-neck panel and hidden in exterior product views. Never generate visible label letters, L.G.B., a white locator, fastener, string or cropped tag fragment on the collar, chest or outer back.",
    "Real cotton weave, absorbed screen-print ink, sharp seams, natural folds and contact shadows; no CGI, pasted art, props, extra garments, watermarks, UI or fake text.",
    note ? `User direction: ${note}.` : "",
    labelHint ? `Label identification hint only: ${labelHint}.` : "",
    "Return only one sharp high-resolution final photo.",
  ].filter(Boolean).join(" ");
}

function fallbackDesignConcept(note?: string) {
  const concepts = [
    ["QUIET TRUCE", "a narrow off-register newspaper photograph of two empty chairs facing each other, with the exact small caption QUIET TRUCE", "a larger torn-paper editorial composition of an empty meeting table and one oxblood underline"],
    ["VEILED FRAME", "a restrained halftone side-profile portrait partly obscured by one translucent vertical ink pass", "a larger rear three-quarter portrait crop with a single oxblood registration line and the exact caption VEILED FRAME"],
    ["OPEN COLUMN", "one elegant hand resting on a weathered stone column, drawn as a compact two-ink editorial plate", "two reaching hands separated by a broken classical column, with generous black negative space"],
    ["NIGHT ROUTE", "a cropped analog road photograph with one thin oxblood route line and the exact caption NIGHT ROUTE", "a larger night-road contact sheet of three uneven frames, no badge, crest or vehicle logo"],
    ["AFTER HOURS", "a grainy doorway silhouette with one offset oxblood shadow, composed as a small editorial hook", "a larger cinema-still composition of an empty corridor and curtains, with the exact caption AFTER HOURS"],
    ["ROUGH NOTE", "one scanned handwritten line crossed by a compact torn-paper portrait fragment", "a larger layered notebook-page composition with one hand, one red pencil mark and the exact words ROUGH NOTE"],
    ["STATIC WEATHER", "a monochrome storm-cloud photograph cropped into an irregular soft-edged halftone", "a larger weather-archive composition with rain streaks, one oxblood overprint and the exact caption STATIC WEATHER"],
    ["BLUE HOUR", "a restrained blue-grey architectural shadow photograph with one narrow vertical crop", "a larger concrete stairwell study with deep blue overprint and the exact caption BLUE HOUR"],
    ["FIELD STUDY", "one fine botanical branch drawing interrupted by a small xerox portrait fragment", "a larger herbarium-style composition of two branches, measured spacing and the exact caption FIELD STUDY"],
    ["RED THREAD", "one elegant human hand pinching a single wine-red thread, rendered as a compact distressed editorial illustration", "two reaching human hands connected by the same wine-red thread, with strong negative space and no symbols"],
  ] as const;
  const requested = Number(note?.match(/design\s+(\d+)\s+of\s+10/i)?.[1] || 1);
  const [title, front, back] = concepts[Math.max(0, Math.min(concepts.length - 1, requested - 1))];
  return [
    "MARKET-GROUNDED FALLBACK: if marketplace evidence is thin, use the proven winner itself as the primary quality and hierarchy reference, then invent an adjacent subject. Never fall back to an arbitrary gothic symbol, tech logo, number, mascot or made-up brand name.",
    `DEMAND-GROUNDED FALLBACK CONCEPT — ${title}.`,
    `FRONT: ${front}.`,
    `BACK: ${back}.`,
  ].join(" ");
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
