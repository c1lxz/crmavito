import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  downloadImageAsBuffer,
  formatProductImageImportError,
  resolveProductImage,
} from "@/lib/avito/fetch-image";
import { getAvitoCredentials } from "@/lib/avito/profile-store";
import { getAvitoStockToken } from "@/lib/avito/stocks";

export const maxDuration = 30;
const FAILED_IMAGE_TTL_MS = 10 * 60_000;
const recentFailures = new Map<string, { expiresAt: number; error: string }>();

function shouldRetryResolve(reason: string): boolean {
  return !/(HTTP 429|HTTP 439|blocked by Avito)/i.test(reason);
}

async function readProfileId(req: Request): Promise<string | null> {
  try {
    const body = (await req.json()) as { avitoProfileId?: unknown };
    return typeof body.avitoProfileId === "string" && body.avitoProfileId.trim()
      ? body.avitoProfileId.trim()
      : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const avitoProfileId = await readProfileId(req);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });

  if (product.imageUrl) {
    const cachedImage = await downloadImageAsBuffer(product.imageUrl);
    if (cachedImage?.length) {
      return NextResponse.json({ imageUrl: product.imageUrl, cached: true });
    }
  }

  const failureKey = id;
  const recentFailure = recentFailures.get(failureKey);
  if (recentFailure && recentFailure.expiresAt > Date.now()) {
    return NextResponse.json({ imageUrl: null, error: recentFailure.error, cached: true });
  }
  recentFailures.delete(failureKey);

  if (!product.avitoItemId && !product.avitoListingUrl) {
    return NextResponse.json({
      imageUrl: null,
      error: formatProductImageImportError("not linked"),
    });
  }

  let avitoToken: string | null = null;
  if (avitoProfileId && product.avitoItemId) {
    try {
      const credentials = await getAvitoCredentials({ profileId: avitoProfileId });
      avitoToken = await getAvitoStockToken(credentials, { attempts: 2 });
    } catch (error) {
      console.warn(
        `[avito] profile token fetch failed for ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let result = await resolveProductImage({
    name: product.name,
    avitoItemId: product.avitoItemId,
    avitoListingUrl: product.avitoListingUrl,
  }, { avitoToken });
  for (let attempt = 1; !result.ok && shouldRetryResolve(result.reason) && attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    result = await resolveProductImage({
      name: product.name,
      avitoItemId: product.avitoItemId,
      avitoListingUrl: product.avitoListingUrl,
    }, { avitoToken });
  }

  if (result.ok) {
    recentFailures.delete(failureKey);
    await prisma.product.update({ where: { id }, data: { imageUrl: result.value } });
    return NextResponse.json({ imageUrl: result.value });
  }

  console.warn(`[avito] resolveProductImage failed for ${id}: ${result.reason}`);
  const error = formatProductImageImportError(result.reason);
  recentFailures.set(failureKey, { expiresAt: Date.now() + FAILED_IMAGE_TTL_MS, error });
  return NextResponse.json({ imageUrl: null, error });
}
