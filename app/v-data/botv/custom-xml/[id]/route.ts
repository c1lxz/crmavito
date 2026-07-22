import { NextResponse } from "next/server";
import { readCustomXmlFeed } from "@/lib/botv/custom-xml-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const xml = await readCustomXmlFeed(id);
    return new NextResponse(xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "XML-фид не найден." }, { status: 404 });
  }
}
