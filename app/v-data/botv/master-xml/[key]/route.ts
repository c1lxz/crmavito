import { NextResponse } from "next/server";
import { readMasterXmlFeed } from "@/lib/botv/master-xml-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    const xml = await readMasterXmlFeed(key);
    return new NextResponse(xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json({ error: "Мастер-фид не найден." }, { status: 404 });
  }
}
