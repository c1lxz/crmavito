import { File } from "node:buffer";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { fetchAvitoAdsAnalytics, type AvitoAdAnalyticsItem } from "@/lib/avito/ads-analytics";
import { downloadImageAsBuffer, resolveProductImage } from "@/lib/avito/fetch-image";
import { getAvitoCredentials, listAvitoProfilesWithCredentials } from "@/lib/avito/profile-store";
import { getAvitoStockToken, type AvitoCredentials } from "@/lib/avito/stocks";
import { createCodexJob, type CodexJob } from "@/lib/ai/content-machine-jobs";
import { hasExtractableWinnerLabel } from "@/lib/flow-agent/label-lock";

export type AnalyticsWinner = AvitoAdAnalyticsItem & {
  profileId: string;
  profileName: string;
  score: number;
};

type PrivateWinner = AnalyticsWinner & { credentials: AvitoCredentials };

export function normalizeDesignCount(value: unknown) {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(100, count));
}

export function analyticsWinnerScore(item: Pick<AvitoAdAnalyticsItem, "views" | "contacts" | "favorites">) {
  return item.contacts * 50 + item.favorites * 10 + item.views;
}

export function selectAnalyticsWinners<T extends AnalyticsWinner>(items: T[], limit = 12): T[] {
  const seenItems = new Set<string>();
  const seenTitles = new Set<string>();
  return [...items]
    .filter((item) => item.views > 0 || item.contacts > 0 || item.favorites > 0)
    .sort((left, right) => right.score - left.score || right.contacts - left.contacts || right.favorites - left.favorites)
    .filter((item) => {
      const itemKey = `${item.profileId}:${item.itemId}`;
      const titleKey = item.title.toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (seenItems.has(itemKey) || (titleKey && seenTitles.has(titleKey))) return false;
      seenItems.add(itemKey);
      if (titleKey) seenTitles.add(titleKey);
      return true;
    })
    .slice(0, Math.max(1, limit));
}

export function selectStrokProfiles<T extends { name: string; hasCredentials: boolean }>(profiles: T[], requestedName?: string): T[] {
  const requested = requestedName?.replace(/\s+/g, " ").trim();
  if (requested) {
    return profiles.filter((profile) => profile.hasCredentials
      && profile.name.localeCompare(requested, "ru", { sensitivity: "accent" }) === 0);
  }
  return profiles.filter((profile) => profile.hasCredentials && /\bstrok(?:\s+shop)?\b/i.test(profile.name));
}

export async function createAnalyticsDesignJobs(input: {
  designCount: number;
  imageSize: "2K" | "4K";
  periodDays?: number;
  profileName?: string;
  garmentType?: "t-shirt";
}): Promise<{ jobs: CodexJob[]; winners: AnalyticsWinner[]; periodDays: number }> {
  const designCount = normalizeDesignCount(input.designCount);
  const periodDays = Math.max(7, Math.min(270, Math.round(input.periodDays || 30)));
  const profileName = input.profileName?.replace(/\s+/g, " ").trim();
  const profiles = selectStrokProfiles(await listAvitoProfilesWithCredentials(), profileName);
  if (!profiles.length) throw new Error("Нет активных профилей Avito с сохранёнными API-ключами.");

  const settled = await Promise.allSettled(profiles.map(async (profile) => {
    const credentials = await getAvitoCredentials({ profileId: profile.id });
    const analytics = await fetchAvitoAdsAnalytics({ profileId: profile.id, credentials, periodDays });
    return analytics.items.map((item): PrivateWinner => ({
      ...item,
      profileId: profile.id,
      profileName: profile.name,
      score: analyticsWinnerScore(item),
      credentials,
    }));
  }));
  const candidates = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((candidate) => input.garmentType !== "t-shirt" || isTShirt(candidate));
  const winners = selectAnalyticsWinners(candidates, Math.min(24, Math.max(8, designCount)));
  if (!winners.length) throw new Error("В аналитике профилей нет позиций с просмотрами, избранным или контактами.");

  const sourceCache = new Map<string, Promise<File>>();
  const usedWinnerKeys = new Set<string>();
  const jobs: CodexJob[] = [];
  const selectedWinners: PrivateWinner[] = [];
  for (let index = 0; index < designCount; index += 1) {
    let winner: PrivateWinner | undefined;
    let source: File | undefined;
    for (let offset = 0; offset < winners.length; offset += 1) {
      const candidate = winners[(index + offset) % winners.length];
      const cacheKey = `${candidate.profileId}:${candidate.itemId}`;
      if (usedWinnerKeys.has(cacheKey)) continue;
      try {
        source = await (sourceCache.get(cacheKey) || cacheWinnerSource(candidate, sourceCache, cacheKey));
        winner = candidate;
        usedWinnerKeys.add(cacheKey);
        break;
      } catch (error) {
        sourceCache.delete(cacheKey);
        console.warn(`[content-machine] analytics source ${candidate.itemId} skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!winner || !source) throw new Error("Ни у одной залетевшей позиции не удалось получить исходное фото.");
    jobs.push(await createCodexJob([source as unknown as globalThis.File], input.imageSize, {
      mode: "original-design",
      preserveWinnerLabel: true,
      inspirationQuery: buildWinnerQuery(winner.title),
      designNote: [
        `AUTOMATIC ANALYTICS WINNER: ${winner.profileName}, Avito ${winner.itemId}.`,
        `Demand evidence for ${periodDays} days: ${winner.views} views, ${winner.favorites} favorites, ${winner.contacts} contacts.`,
        `Create unique design ${index + 1} of ${designCount}; retain the demand logic, not the source artwork.`,
        "Preserve the winner's actual hero-side hierarchy. Put the strongest composition on the side that carries the winner's commercial impact; make the other side a distinct, deliberate supporting composition. Never repeat the same principal object on both sides and never leave the supporting side as one tiny token.",
        "Preserve the winner's exact visible internal neck label or heat-transfer marking on every front-facing result whenever the inside back-neck panel is visible. Never invent a replacement label and never place it on the exterior back.",
      ].join(" "),
    }));
    selectedWinners.push(winner);
  }

  return {
    jobs,
    periodDays,
    winners: selectedWinners.map(({ credentials: _credentials, ...winner }) => winner),
  };
}

export function isTShirt(item: Pick<AvitoAdAnalyticsItem, "title" | "description">) {
  const haystack = [item.title, item.description].filter(Boolean).join(" ").toLocaleLowerCase("ru");
  return haystack.includes("футбол") || haystack.includes("t-shirt") || haystack.includes("tshirt") || /(^|\s)tee(\s|$)/i.test(haystack);
}

export function isWinnerIdentityMismatch(title: string, collarOcr: string) {
  const ignored = new Set(["футболка", "graphic", "shirt", "tshirt", "tee", "black", "edition", "archived"]);
  const tokens = (value: string) => value.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{3,}/gu) || [];
  const titleTokens = new Set(tokens(title).filter((token) => !ignored.has(token)));
  const ocrTokens = [...new Set(tokens(collarOcr).filter((token) => !ignored.has(token) && token !== "avito"))];
  return ocrTokens.length >= 2 && !ocrTokens.some((token) => titleTokens.has(token));
}

function cacheWinnerSource(winner: PrivateWinner, cache: Map<string, Promise<File>>, key: string) {
  const pending = loadWinnerSource(winner);
  cache.set(key, pending);
  return pending;
}

async function loadWinnerSource(winner: PrivateWinner) {
  let imageUrl = winner.imageUrl;
  if (!imageUrl) {
    const token = await getAvitoStockToken(winner.credentials);
    const resolved = await resolveProductImage({
      name: winner.title,
      avitoItemId: winner.itemId,
      avitoListingUrl: winner.url,
    }, { avitoToken: token });
    if (resolved.ok) imageUrl = resolved.value;
  }
  if (!imageUrl) throw new Error(`У позиции Avito ${winner.itemId} не найдено исходное фото.`);
  const source = await downloadImageAsBuffer(imageUrl);
  if (!source?.length) throw new Error(`Фото позиции Avito ${winner.itemId} не загрузилось.`);
  const normalized = await sharp(source)
    .rotate()
    .resize({ width: 2_400, height: 2_400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  if (!(await hasExtractableWinnerLabel(normalized))) {
    throw new Error(`У позиции Avito ${winner.itemId} на основном фото не видна бирка; выбрана следующая залетевшая футболка.`);
  }
  const collarOcr = await readWinnerCollarText(normalized);
  if (collarOcr && isWinnerIdentityMismatch(winner.title, collarOcr)) {
    throw new Error(`У позиции Avito ${winner.itemId} фото не совпадает с названием (${collarOcr.slice(0, 80)}); выбрана следующая залетевшая футболка.`);
  }
  return new File([normalized], `analytics-${winner.itemId}.jpg`, { type: "image/jpeg" });
}

async function readWinnerCollarText(image: Buffer): Promise<string> {
  const metadata = await sharp(image).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) return "";
  const collar = await sharp(image)
    .extract({ left: 0, top: 0, width, height: Math.max(1, Math.round(height * 0.42)) })
    .greyscale().normalize().sharpen().resize({ width: 1_600, withoutEnlargement: false })
    .jpeg({ quality: 88 }).toBuffer();
  return new Promise((resolve) => {
    const child = spawn("tesseract", ["stdin", "stdout", "-l", "eng", "--psm", "11", "tsv"], { windowsHide: true });
    let output = "";
    const timer = setTimeout(() => child.kill(), 15_000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", () => { clearTimeout(timer); resolve(""); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve("");
      const confidentWords = output.split(/\r?\n/).slice(1).flatMap((line) => {
        const columns = line.split("\t");
        const confidence = Number(columns[10]);
        const word = columns[11]?.trim() || "";
        return confidence >= 80 && /^[a-z]{4,}$/i.test(word) ? [word] : [];
      });
      resolve(confidentWords.join(" "));
    });
    child.stdin.end(collar);
  });
}

function buildWinnerQuery(title: string) {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 90);
  return `${clean} archive designer graphic`.slice(0, 120);
}
