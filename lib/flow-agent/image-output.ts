import sharp from "sharp";

export type FlowImageSize = "2K" | "4K";

export async function normalizeFlowResult(source: Buffer, imageSize: FlowImageSize) {
  const image = sharp(source).rotate();
  if (imageSize === "2K") {
    return image.png({ compressionLevel: 8, adaptiveFiltering: true }).toBuffer();
  }
  return image.resize({
    width: 4096,
    height: 4096,
    fit: "inside",
    kernel: sharp.kernel.lanczos3,
  }).png({ compressionLevel: 8, adaptiveFiltering: true }).toBuffer();
}
