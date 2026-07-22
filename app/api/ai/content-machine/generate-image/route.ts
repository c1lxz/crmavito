import sharp from "sharp";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseBackgroundSlot, readBackground, validateImageFile } from "@/lib/ai/content-machine";
import { buildProductPhotoPrompt, generateGeminiImage, type GeminiReferenceImage } from "@/lib/ai/gemini-images";

export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });

  try {
    const form = await request.formData();
    const product = form.get("product");
    const backgroundSlot = parseBackgroundSlot(form.get("backgroundSlot"));
    const imageSize = form.get("imageSize") === "4K" ? "4K" : "2K";
    if (!(product instanceof File) || !backgroundSlot) {
      return NextResponse.json({ error: "Передайте фото товара и номер эталонного фона." }, { status: 400 });
    }
    validateImageFile(product);

    const [productBuffer, background] = await Promise.all([
      product.arrayBuffer().then((data) => Buffer.from(data)),
      readBackground(backgroundSlot),
    ]);
    const metadata = await sharp(background.buffer).metadata();
    const aspectRatio = closestAspectRatio(metadata.width, metadata.height);
    const referenceImages: GeminiReferenceImage[] = [
      { data: productBuffer.toString("base64"), mimeType: product.type },
      { data: background.buffer.toString("base64"), mimeType: background.mimeType },
    ];
    const image = await generateGeminiImage({
      prompt: buildProductPhotoPrompt(),
      referenceImages,
      aspectRatio,
      imageSize,
    });
    return NextResponse.json({ ...image, backgroundSlot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

function closestAspectRatio(width?: number, height?: number) {
  if (!width || !height) return "1:1" as const;
  const ratio = width / height;
  const options = [
    ["1:1", 1], ["3:2", 3 / 2], ["2:3", 2 / 3], ["3:4", 3 / 4], ["4:3", 4 / 3],
    ["4:5", 4 / 5], ["5:4", 5 / 4], ["9:16", 9 / 16], ["16:9", 16 / 9], ["21:9", 21 / 9],
  ] as const;
  return options.reduce((best, option) => Math.abs(option[1] - ratio) < Math.abs(best[1] - ratio) ? option : best)[0];
}
