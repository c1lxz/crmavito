import fs from "node:fs";

const [previousPath, latestPath, outputPath] = process.argv.slice(2);
if (!previousPath || !latestPath || !outputPath) {
  throw new Error("Usage: node scripts/merge-ky-strok-feeds.mjs <previous.xml> <latest.xml> <output.xml>");
}

const guideUrl = "https://crmavito.duckdns.org/assets/ky-strok-size-guide-v2.jpg";
const kyContactPhone = "+79334320087";
const readXml = (file) => fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
const previous = readXml(previousPath);
const latest = readXml(latestPath);

function adsBody(xml) {
  const match = xml.match(/<Ads\b[^>]*>([\s\S]*)<\/Ads>\s*$/i);
  if (!match) throw new Error("Некорректный XML: не найден корневой элемент Ads.");
  return match[1].trim();
}

const root = previous.match(/^[\s\S]*?<Ads\b[^>]*>/i)?.[0];
if (!root) throw new Error("В предыдущем XML не найден корневой элемент Ads.");

let combined = `${root}\n${adsBody(previous)}\n${adsBody(latest)}\n</Ads>\n`;
combined = combined.replace(
  /<ContactPhone>[^<]*<\/ContactPhone>/g,
  `<ContactPhone>${kyContactPhone}</ContactPhone>`,
);
combined = combined.replace(/<Ad\b[\s\S]*?<\/Ad>/g, (ad) => {
  const withoutPreviousGuides = ad.replace(
    /\s*<Image\b[^>]*url=["'][^"']*\/ky-strok-size-guide(?:-v\d+)?\.jpg[^"']*["'][^>]*\/?>/gi,
    "",
  );
  return withoutPreviousGuides.replace(
    /<\/Images>/i,
    `      <Image url="${guideUrl}"/>\n    </Images>`,
  );
});

const ids = Array.from(combined.matchAll(/<Id>([^<]+)<\/Id>/g), (match) => match[1]);
const ads = combined.match(/<Ad\b/g)?.length ?? 0;
const guideImages = combined.split(guideUrl).length - 1;
const imageSections = Array.from(combined.matchAll(/<Images>([\s\S]*?)<\/Images>/g), (match) => match[1]);
const guideIsLast = imageSections.every((images) => images.trim().endsWith(`url="${guideUrl}"/>`));
const phones = new Set(Array.from(
  combined.matchAll(/<ContactPhone>([^<]*)<\/ContactPhone>/g),
  (match) => match[1].trim(),
));
if (!ads || ids.length !== ads || new Set(ids).size !== ads || guideImages !== ads || !guideIsLast) {
  throw new Error(JSON.stringify({
    ads,
    ids: ids.length,
    uniqueIds: new Set(ids).size,
    guideImages,
    guideIsLast,
  }));
}

fs.writeFileSync(outputPath, combined, "utf8");
console.log(JSON.stringify({ ads, uniqueIds: ads, guideImages, guideIsLast, phones: [...phones], outputPath }));
