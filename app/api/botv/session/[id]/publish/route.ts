import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { buildPublicationXml, savePublishedXml } from "@/lib/botv/session";
import { publishAvitoXml } from "@/lib/avito/publish";
import { getAvitoCredentials, getAvitoProfileAutoloadSettings } from "@/lib/avito/profile-store";

export const runtime = "nodejs";
export const maxDuration = 300;

const publishSchema = z.object({
  profileId: z.string().trim().optional().nullable(),
  clientId: z.string().trim().optional().nullable(),
  clientSecret: z.string().trim().optional().nullable(),
  reportEmail: z.string().trim().email().optional().nullable(),
  contactPhone: z.string().trim().optional().nullable(),
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

function publicXmlFeedUrl(request: Request, sessionId: string, profileId?: string | null, phone?: string | null): string {
  const url = new URL(`${publicBaseUrl(request)}/v-data/botv/work/${encodeURIComponent(sessionId)}/xml`);
  if (profileId) url.searchParams.set("profileId", profileId);
  if (phone?.trim()) url.searchParams.set("phone", phone.trim());
  if (profileId) url.searchParams.set("includePrevious", "1");
  return url.toString();
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
    const profileScope = parsed.data.legacyIds ? null : (parsed.data.profileId || parsed.data.clientId);
    const savedSettings = await getAvitoProfileAutoloadSettings(parsed.data.profileId);
    const reportEmail = parsed.data.reportEmail?.trim() || savedSettings.reportEmail;
    const contactPhone = parsed.data.contactPhone?.trim() || savedSettings.contactPhone;
    const xmlResult = await buildPublicationXml(id, contactPhone, {
      profileId: profileScope,
      includePrevious: !parsed.data.legacyIds,
    });
    const publish = await publishAvitoXml(credentials, xmlResult.xml, xmlResult.filename, {
      feedUrl: publicXmlFeedUrl(
        request,
        id,
        parsed.data.legacyIds ? undefined : profileScope,
        !parsed.data.profileId ? contactPhone : undefined,
      ),
      reportEmail,
    });
    await savePublishedXml(parsed.data.legacyIds ? undefined : profileScope, xmlResult.xml);
    return NextResponse.json({
      success: true,
      ads: xmlResult.ads,
      products: xmlResult.products,
      previousAds: xmlResult.previousAds,
      adIds: xmlResult.adIds ?? [],
      legacyIds: parsed.data.legacyIds,
      publish,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
