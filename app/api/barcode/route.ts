import { NextRequest, NextResponse } from "next/server";
import bwipjs from "bwip-js/node";
import { auth } from "@/lib/auth";

const MAX_BARCODE_LENGTH = 200;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text")?.trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (text.length > MAX_BARCODE_LENGTH) {
    return NextResponse.json({ error: "text too long" }, { status: 400 });
  }

  try {
    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text,
      scale: 3,
      height: 18,
      includetext: true,
      textxalign: "center",
      paddingwidth: 10,
      paddingheight: 10,
      backgroundcolor: "FFFFFF",
    });

    return new NextResponse(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
