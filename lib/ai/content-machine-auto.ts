import { File } from "node:buffer";
import sharp from "sharp";
import { fetchAvitoAdsAnalytics, type AvitoAdAnalyticsItem } from "@/lib/avito/ads-analytics";
import { downloadImageAsBuffer, resolveProductImage } from "@/lib/avito/fetch-image";
import { getAvitoCredentials, listAvitoProfilesWithCredentials } from "@/lib/avito/profile-store";
import { getAvitoStockToken, type AvitoCredentials } from "@/lib/avito/stocks";
import { createCodexJob, type CodexJob } from "@/lib/ai/content-machine-jobs";

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

export async function createAnalyticsDesignJobs(input: {
  designCount: number;
  imageSize: "2K" | "4K";
  periodDays?: number;
}): Promise<{ jobs: CodexJob[]; winners: AnalyticsWinner[]; periodDays: number }> {
  const designCount = normalizeDesignCount(input.designCount);
  const periodDays = Math.max(7, Math.min(270, Math.round(input.periodDays || 30)));
  const profiles = (await listAvitoProfilesWithCredentials()).filter((profile) => profile.hasCredentials);
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
  const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const winners = selectAnalyticsWinners(candidates, Math.min(24, Math.max(8, designCount)));
  if (!winners.length) throw new Error("В аналитике профилей нет позиций с просмотрами, избранным или контактами.");

  const sourceCache = new Map<string, Promise<File>>();
  const jobs: CodexJob[] = [];
  for (let index = 0; index < designCount; index += 1) {
    let winner: PrivateWinner | undefined;
    let source: File | undefined;
    for (let offset = 0; offset < winners.length; offset += 1) {
      const candidate = winners[(index + offset) % winners.length];
      const cacheKey = `${candidate.profileId}:${candidate.itemId}`;
      try {
        source = await (sourceCache.get(cacheKey) || cacheWinnerSource(candidate, sourceCache, cacheKey));
        winner = candidate;
        break;
      } catch (error) {
        sourceCache.delete(cacheKey);
        console.warn(`[content-machine] analytics source ${candidate.itemId} skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!winner || !source) throw new Error("Ни у одной залетевшей позиции не удалось получить исходное фото.");
    jobs.push(await createCodexJob([source as unknown as globalThis.File], input.imageSize, {
      mode: "original-design",
      inspirationQuery: buildWinnerQuery(winner.title),
      designNote: [
        `AUTOMATIC ANALYTICS WINNER: ${winner.profileName}, Avito ${winner.itemId}.`,
        `Demand evidence for ${periodDays} days: ${winner.views} views, ${winner.favorites} favorites, ${winner.contacts} contacts.`,
        `Create unique design ${index + 1} of ${designCount}; retain the demand logic, not the source artwork.`,
        "Use a restrained secondary hook on the front and a distinct hero subject on the back. Never repeat the same principal object on both sides.",
        "No hang tags, paper tags, sewn labels, woven tabs, white collar locators, fasteners, strings or tag fragments. The internal heat-transfer marking stays hidden in exterior photos.",
      ].join(" "),
    }));
  }

  return {
    jobs,
    periodDays,
    winners: winners.map(({ credentials: _credentials, ...winner }) => winner),
  };
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
  return new File([normalized], `analytics-${winner.itemId}.jpg`, { type: "image/jpeg" });
}

function buildWinnerQuery(title: string) {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 90);
  return `${clean} archive designer graphic`.slice(0, 120);
}
