import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAvitoCredentials, getAvitoProfileAutoloadSettings } from "@/lib/avito/profile-store";
import { fetchAvitoAutoloadProfile, publishAvitoXml } from "@/lib/avito/publish";
import { inspectAvitoXml } from "@/lib/botv/custom-xml-feed";
import {
  masterFeedKey,
  prepareMasterXmlFeed,
  rollbackMasterXmlFeed,
  saveMasterXmlFeed,
  type SavedMasterXml,
} from "@/lib/botv/master-xml-feed";

export const runtime = "nodejs";
export const maxDuration = 300;

function publicBaseUrl(request: Request): string {
  const fallback = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") || fallback.protocol.replace(":", "") || "https";
  const rawHost = (request.headers.get("x-forwarded-host") || request.headers.get("host") || fallback.host)
    .split(",")[0]
    .trim();
  const host = (rawHost || "crmavito.duckdns.org")
    .replace(/:\d+$/, "")
    .replace(/^localhost$/, "crmavito.duckdns.org");
  return `${protocol}://${host}`;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xml")) {
      return NextResponse.json({ error: "Выберите XML-файл." }, { status: 400 });
    }

    const profileId = String(form.get("profileId") ?? "").trim() || null;
    const clientId = String(form.get("clientId") ?? "").trim() || null;
    const clientSecret = String(form.get("clientSecret") ?? "").trim() || null;
    const reportEmail = String(form.get("reportEmail") ?? "").trim() || null;
    const credentials = await getAvitoCredentials({ profileId, clientId, clientSecret });
    const settings = await getAvitoProfileAutoloadSettings(profileId);
    const inspected = inspectAvitoXml(await file.text());
    const profileScope = profileId || clientId;
    if (!profileScope) throw new Error("Выберите профиль Avito для безопасного мастер-фида.");
    const key = masterFeedKey(profileScope);
    const feedUrl = `${publicBaseUrl(request)}/v-data/botv/master-xml/${key}`;
    const autoloadProfile = await fetchAvitoAutoloadProfile(credentials);
    const master = await prepareMasterXmlFeed({
      key,
      incomingXml: inspected.xml,
      bootstrapFeedUrl: autoloadProfile.feeds[0]?.url,
    });
    let saved: SavedMasterXml | null = null;
    let publish;
    try {
      saved = await saveMasterXmlFeed(key, master.xml);
      publish = await publishAvitoXml(credentials, master.xml, `crmavito-${key}.xml`, {
        feedUrl,
        reportEmail: reportEmail || settings.reportEmail,
      });
    } catch (error) {
      if (saved) await rollbackMasterXmlFeed(saved);
      throw error;
    }

    return NextResponse.json({
      success: true,
      ads: master.ads,
      adIds: inspected.adIds,
      filename: file.name,
      master: {
        previousAds: master.previousAds,
        addedAds: master.addedAds,
        updatedAds: master.updatedAds,
        removedAds: master.removedAds,
        totalAds: master.ads,
      },
      publish,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
