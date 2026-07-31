import sharp from "sharp";

export type FlowImageSize = "2K" | "4K";

export async function normalizeFlowResult(source: Buffer, imageSize: FlowImageSize) {
  const maxOutputEdge = imageSize === "4K" ? 4096 : 2048;
  return sharp(source)
    .rotate()
    .resize({
      width: maxOutputEdge,
      height: maxOutputEdge,
      fit: "inside",
      withoutEnlargement: imageSize === "2K",
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();
}
