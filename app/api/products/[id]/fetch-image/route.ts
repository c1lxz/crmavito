import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { downloadImageAsBuffer, resolveProductImage } from "@/lib/avito/fetch-image";

export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });

  if (product.imageUrl) {
    const cachedImage = await downloadImageAsBuffer(product.imageUrl);
    if (cachedImage?.length) {
      return NextResponse.json({ imageUrl: product.imageUrl, cached: true });
    }
  }
  if (!product.avitoItemId && !product.avitoListingUrl) {
    return NextResponse.json({
      imageUrl: null,
      error: "Товар не связан с объявлением Avito",
    });
  }

  let result = await resolveProductImage({
    avitoItemId: product.avitoItemId,
    avitoListingUrl: product.avitoListingUrl,
  });
  for (let attempt = 1; !result.ok && attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    result = await resolveProductImage({
      avitoItemId: product.avitoItemId,
      avitoListingUrl: product.avitoListingUrl,
    });
  }

  if (result.ok) {
    await prisma.product.update({ where: { id }, data: { imageUrl: result.value } });
    return NextResponse.json({ imageUrl: result.value });
  }

  console.warn(`[avito] resolveProductImage failed for ${id}: ${result.reason}`);
  return NextResponse.json({ imageUrl: null, error: result.reason });
}
