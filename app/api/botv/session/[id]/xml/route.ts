import { NextResponse } from "next/server";
import { buildPublicationXml, buildXml } from "@/lib/botv/session";
import { getAvitoProfileContactPhone } from "@/lib/avito/profile-store";

export const runtime = "nodejs";
export const maxDuration = 300;

function xmlResponse(result: { filename: string; xml: string; ads: number; products: number }) {
  return new NextResponse(result.xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="${result.filename}"`,
      "x-botv-ads": String(result.ads),
      "x-botv-products": String(result.products),
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const profileId = url.searchParams.get("profileId");
    const phone = await getAvitoProfileContactPhone(profileId);
    const includePrevious = url.searchParams.get("includePrevious") === "1";
    const result = includePrevious
      ? await buildPublicationXml(id, phone, { profileId, includePrevious: true })
      : await buildXml(id, phone, { profileId });
    return xmlResponse(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка XML" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let phone = "";
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      phone = typeof body.phone === "string" ? body.phone : "";
    }
    const url = new URL(request.url);
    const profileId = url.searchParams.get("profileId");
    phone ||= await getAvitoProfileContactPhone(profileId) || "";
    const includePrevious = url.searchParams.get("includePrevious") === "1";
    const result = includePrevious
      ? await buildPublicationXml(id, phone, { profileId, includePrevious: true })
      : await buildXml(id, phone, { profileId });
    return xmlResponse(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка XML" }, { status: 500 });
  }
}
