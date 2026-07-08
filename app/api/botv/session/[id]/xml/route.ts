import { NextResponse } from "next/server";
import { buildXml } from "@/lib/botv/session";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let phone = "";
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      phone = typeof body.phone === "string" ? body.phone : "";
    }
    const result = await buildXml(id, phone);
    return new NextResponse(result.xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${result.filename}"`,
        "x-botv-ads": String(result.ads),
        "x-botv-products": String(result.products),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка XML" }, { status: 500 });
  }
}
