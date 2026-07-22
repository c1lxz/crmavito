import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAvitoCredentials, getAvitoProfileAutoloadSettings } from "@/lib/avito/profile-store";
import { publishAvitoXml } from "@/lib/avito/publish";
import { inspectAvitoXml, saveCustomXmlFeed } from "@/lib/botv/custom-xml-feed";

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
    const feedId = await saveCustomXmlFeed(inspected.xml);
    const feedUrl = `${publicBaseUrl(request)}/v-data/botv/custom-xml/${feedId}`;
    const publish = await publishAvitoXml(credentials, inspected.xml, file.name, {
      feedUrl,
      reportEmail: reportEmail || settings.reportEmail,
    });

    return NextResponse.json({
      success: true,
      ads: inspected.ads,
      adIds: inspected.adIds,
      filename: file.name,
      publish,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
