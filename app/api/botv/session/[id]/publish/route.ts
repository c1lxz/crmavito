import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { buildXml } from "@/lib/botv/session";
import { publishAvitoXml } from "@/lib/avito/publish";
import { getAvitoCredentials, getAvitoProfileReportEmail } from "@/lib/avito/profile-store";

export const runtime = "nodejs";
export const maxDuration = 300;

const publishSchema = z.object({
  profileId: z.string().trim().min(1),
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

function publicXmlFeedUrl(request: Request, sessionId: string, profileId?: string): string {
  const url = new URL(`${publicBaseUrl(request)}/v-data/botv/work/${encodeURIComponent(sessionId)}/xml`);
  if (profileId) url.searchParams.set("profileId", profileId);
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
    const [xmlResult, reportEmail] = await Promise.all([
      buildXml(id, undefined, { profileId: parsed.data.legacyIds ? null : parsed.data.profileId }),
      getAvitoProfileReportEmail(parsed.data.profileId),
    ]);
    const publish = await publishAvitoXml(credentials, xmlResult.xml, xmlResult.filename, {
      feedUrl: publicXmlFeedUrl(request, id, parsed.data.legacyIds ? undefined : parsed.data.profileId),
      reportEmail,
    });
    return NextResponse.json({
      success: true,
      ads: xmlResult.ads,
      products: xmlResult.products,
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
