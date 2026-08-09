import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { buildXml } from "@/lib/botv/session";
import { fetchAvitoAutoloadProfile, publishAvitoXml, resolveAvitoXmlContactPhone } from "@/lib/avito/publish";
import { getAvitoCredentials, getAvitoProfileAutoloadSettings } from "@/lib/avito/profile-store";
import {
  masterFeedKey,
  prepareMasterXmlFeed,
  rollbackMasterXmlFeed,
  saveMasterXmlFeed,
  type SavedMasterXml,
} from "@/lib/botv/master-xml-feed";

export const runtime = "nodejs";
export const maxDuration = 300;

const publishSchema = z.object({
  profileId: z.string().trim().optional().nullable(),
  clientId: z.string().trim().optional().nullable(),
  clientSecret: z.string().trim().optional().nullable(),
  reportEmail: z.string().trim().email().optional().nullable(),
  legacyIds: z.boolean().optional().default(false),
});

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

function publicMasterXmlFeedUrl(request: Request, key: string): string {
  return `${publicBaseUrl(request)}/v-data/botv/master-xml/${key}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }

  const parsed = publishSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Выберите профиль Avito." }, { status: 400 });
  }

  const { id } = await params;
  if (parsed.data.legacyIds) {
    return NextResponse.json({
      error: "Публикация со старыми SKU-1, SKU-2 отключена: такие ID могут перезаписать другой дроп. Старые ID можно только скачать для ручного восстановления.",
    }, { status: 409 });
  }
  let credentials;
  try {
    credentials = await getAvitoCredentials(parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  try {
    const profileScope = parsed.data.profileId || parsed.data.clientId;
    if (!profileScope) throw new Error("Выберите профиль Avito для безопасного мастер-фида.");
    const savedSettings = await getAvitoProfileAutoloadSettings(parsed.data.profileId);
    const reportEmail = parsed.data.reportEmail?.trim() || savedSettings.reportEmail;
    const contactPhone = await resolveAvitoXmlContactPhone(credentials, savedSettings.contactPhone);
    const xmlResult = await buildXml(id, contactPhone, { profileId: profileScope });
    const key = masterFeedKey(profileScope);
    const feedUrl = publicMasterXmlFeedUrl(request, key);
    const autoloadProfile = await fetchAvitoAutoloadProfile(credentials);
    const master = await prepareMasterXmlFeed({
      key,
      incomingXml: xmlResult.xml,
      bootstrapFeedUrl: autoloadProfile.feeds[0]?.url,
    });
    let saved: SavedMasterXml | null = null;
    let publish;
    try {
      saved = await saveMasterXmlFeed(key, master.xml);
      publish = await publishAvitoXml(credentials, master.xml, `crmavito-${key}.xml`, {
        feedUrl,
        reportEmail,
      });
    } catch (error) {
      if (saved) await rollbackMasterXmlFeed(saved);
      throw error;
    }
    return NextResponse.json({
      success: true,
      ads: master.ads,
      products: xmlResult.products,
      adIds: xmlResult.adIds ?? [],
      legacyIds: false,
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
