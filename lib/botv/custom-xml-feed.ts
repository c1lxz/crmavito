import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const feedsDir = path.join(process.cwd(), "botv", "tmp", "custom_xml_feeds");
const MAX_XML_BYTES = 50 * 1024 * 1024;
export const SIZE_GUIDE_URL =
  "https://crmavito.duckdns.org/assets/ky-strok-size-guide-v2.jpg";

export type AvitoXmlInspection = {
  xml: string;
  ads: number;
  adIds: string[];
};

export function inspectAvitoXml(value: string): AvitoXmlInspection {
  const xml = value.replace(/^\uFEFF/, "").trim();
  if (!xml) throw new Error("XML-файл пустой.");
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) {
    throw new Error("XML-файл больше 50 МБ.");
  }
  if (!/^<\?xml\b[^>]*>\s*<Ads\b[^>]*>/i.test(xml) || !/<\/Ads>\s*$/i.test(xml)) {
    throw new Error("Ожидается XML Avito с корневым элементом Ads.");
  }

  const openedAds = xml.match(/<Ad\b[^>]*>/g)?.length ?? 0;
  const closedAds = xml.match(/<\/Ad>/g)?.length ?? 0;
  const adIds = Array.from(xml.matchAll(/<Id>([^<]+)<\/Id>/g), (match) => match[1].trim());
  if (openedAds === 0 || openedAds !== closedAds || adIds.length !== openedAds) {
    throw new Error("XML повреждён: не совпадает количество Ad и Id.");
  }
  if (new Set(adIds).size !== adIds.length) {
    throw new Error("XML содержит повторяющиеся Id объявлений.");
  }

  return { xml: `${appendSizeGuideToAds(xml)}\n`, ads: openedAds, adIds };
}

export function appendSizeGuideToAds(xml: string): string {
  return xml.replace(/<Ad\b[^>]*>[\s\S]*?<\/Ad>/gi, (ad) => {
    const withoutPreviousGuides = ad.replace(
      /\s*<Image\b[^>]*url=["'][^"']*\/ky-strok-size-guide(?:-v\d+)?\.jpg[^"']*["'][^>]*\/?>/gi,
      "",
    );
    if (/<\/Images>/i.test(withoutPreviousGuides)) {
      return withoutPreviousGuides.replace(
        /<\/Images>/i,
        `  <Image url="${SIZE_GUIDE_URL}"/>\n</Images>`,
      );
    }
    return withoutPreviousGuides.replace(
      /<\/Ad>/i,
      `<Images><Image url="${SIZE_GUIDE_URL}"/></Images>\n</Ad>`,
    );
  });
}

export async function saveCustomXmlFeed(xml: string): Promise<string> {
  await mkdir(feedsDir, { recursive: true });
  const id = randomUUID();
  await writeFile(path.join(feedsDir, `${id}.xml`), xml, "utf8");
  return id;
}

export async function readCustomXmlFeed(id: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Некорректный ID XML-фида.");
  return readFile(path.join(feedsDir, `${id}.xml`), "utf8");
}
