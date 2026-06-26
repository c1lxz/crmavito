import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export const maxDuration = 30;

function pickAvitoImage(html: string): string | null {
  const isJunk = (u: string) => /icons?\/|touch-icon|favicon|logo|sprite/i.test(u);

  const cdnMatches = html.matchAll(/https?:\/\/[^"'\s>]*avito\.st\/(?:image|stat|hi)[^"'\s>]*\.(?:jpg|jpeg|png|webp)/gi);
  for (const m of cdnMatches) {
    if (!isJunk(m[0])) return m[0];
  }

  const ogTags = html.matchAll(/<meta\s[^>]*property=["']og:image(?::secure_url|:url)?["'][^>]*>/gi);
  for (const tag of ogTags) {
    const content = tag[0].match(/content=["']([^"']+)["']/i)?.[1];
    if (content && !isJunk(content)) return content;
  }

  const twTag = html.match(/<meta\s[^>]*(?:name|property)=["']twitter:image["'][^>]*>/i);
  const content = twTag?.[0].match(/content=["']([^"']+)["']/i)?.[1];
  if (content && !isJunk(content)) return content;

  return null;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });

  if (product.imageUrl) return NextResponse.json({ imageUrl: product.imageUrl, cached: true });
  if (!product.avitoListingUrl) return NextResponse.json({ imageUrl: null, error: "Нет ссылки на Avito" });

  try {
    const r = await fetch(product.avitoListingUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return NextResponse.json({ imageUrl: null, error: `Avito: ${r.status}` });
    const html = await r.text();
    const imageUrl = pickAvitoImage(html);
    if (imageUrl) {
      await prisma.product.update({ where: { id }, data: { imageUrl } });
    }
    return NextResponse.json({ imageUrl });
  } catch (e) {
    return NextResponse.json({ imageUrl: null, error: String(e).slice(0, 200) });
  }
}
