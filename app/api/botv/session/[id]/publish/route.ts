import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { buildXml } from "@/lib/botv/session";
import { fetchAvitoAccountProfile } from "@/lib/avito/profile";
import { getAvitoXmlPublishEndpoint, publishAvitoXml } from "@/lib/avito/publish";
import { getAvitoCredentials, saveAvitoProfileCredentials } from "@/lib/avito/profile-store";

export const runtime = "nodejs";
export const maxDuration = 300;

const publishSchema = z.object({
  profileId: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  clientSecret: z.string().trim().optional(),
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
    getAvitoXmlPublishEndpoint();
    const [xmlResult, profile] = await Promise.all([
      buildXml(id),
      fetchAvitoAccountProfile(credentials),
    ]);
    const savedProfile = await saveAvitoProfileCredentials(credentials, profile);
    const publish = await publishAvitoXml(credentials, xmlResult.xml, xmlResult.filename);
    return NextResponse.json({
      success: true,
      profile: savedProfile,
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
