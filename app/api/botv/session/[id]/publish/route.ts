import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { buildXml } from "@/lib/botv/session";
import { fetchAvitoAccountProfile } from "@/lib/avito/profile";
import { publishAvitoXml } from "@/lib/avito/publish";

export const runtime = "nodejs";
export const maxDuration = 300;

const publishSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }

  const parsed = publishSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Укажите client_id и client_secret Avito." }, { status: 400 });
  }

  const { id } = await params;
  const credentials = {
    clientId: parsed.data.clientId,
    clientSecret: parsed.data.clientSecret,
  };

  try {
    const [xmlResult, profile] = await Promise.all([
      buildXml(id),
      fetchAvitoAccountProfile(credentials),
    ]);
    const publish = await publishAvitoXml(credentials, xmlResult.xml, xmlResult.filename);
    return NextResponse.json({
      success: true,
      profile,
      ads: xmlResult.ads,
      products: xmlResult.products,
      publish,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
