import sharp from "sharp";

export type FlowImageSize = "2K" | "4K";

export type FlowImageDimensions = { width: number; height: number };

export function compareFlowImageGeometry(reference: FlowImageDimensions, candidate: FlowImageDimensions) {
  const referenceRatio = reference.width / reference.height;
  const candidateRatio = candidate.width / candidate.height;
  const valid = [referenceRatio, candidateRatio].every((value) => Number.isFinite(value) && value > 0);
  if (!valid) return { pass: false, issue: "Output or background has invalid dimensions." };

  const referenceOrientation = referenceRatio > 1.05 ? "landscape" : referenceRatio < 0.95 ? "portrait" : "square";
  const candidateOrientation = candidateRatio > 1.05 ? "landscape" : candidateRatio < 0.95 ? "portrait" : "square";
  if (referenceOrientation !== candidateOrientation) {
    return {
      pass: false,
      issue: `Canvas must remain ${referenceOrientation}; generated image is ${candidateOrientation}.`,
    };
  }
  const relativeRatioError = Math.abs(Math.log(candidateRatio / referenceRatio));
  if (relativeRatioError > 0.08) {
    return {
      pass: false,
      issue: `Canvas aspect ratio must match the background (${reference.width}:${reference.height}); got ${candidate.width}:${candidate.height}.`,
    };
  }
  return { pass: true, issue: "" };
}

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

export async function createExactFrontPrintDetail(source: Buffer) {
  const normalized = await sharp(source).rotate().png().toBuffer({ resolveWithObject: true });
  const width = normalized.info.width;
  const height = normalized.info.height;
  const analysis = await sharp(normalized.data)
    .resize({ width: Math.min(384, width), withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const roi = {
    left: Math.round(analysis.info.width * 0.18),
    right: Math.round(analysis.info.width * 0.82),
    top: Math.round(analysis.info.height * 0.25),
    bottom: Math.round(analysis.info.height * 0.7),
  };
  const rowCounts = new Array(analysis.info.height).fill(0) as number[];
  for (let y = roi.top; y < roi.bottom; y += 1) {
    for (let x = roi.left; x < roi.right; x += 1) {
      const offset = (y * analysis.info.width + x) * analysis.info.channels;
      const luminance = analysis.data[offset] * 0.2126
        + analysis.data[offset + 1] * 0.7152
        + analysis.data[offset + 2] * 0.0722;
      if (luminance > 115) rowCounts[y] += 1;
    }
  }
  const activeRows = rowCounts.map((count) => count >= Math.max(2, (roi.right - roi.left) * 0.012));
  const segments: Array<{ top: number; bottom: number; score: number }> = [];
  let segmentStart = -1;
  let lastActive = -1;
  for (let y = roi.top; y <= roi.bottom; y += 1) {
    if (y < roi.bottom && activeRows[y]) {
      if (segmentStart < 0) segmentStart = y;
      lastActive = y;
    }
    if (segmentStart >= 0 && (y === roi.bottom || y - lastActive > 2)) {
      segments.push({
        top: segmentStart,
        bottom: lastActive + 1,
        score: rowCounts.slice(segmentStart, lastActive + 1).reduce((sum, count) => sum + count, 0),
      });
      segmentStart = -1;
      lastActive = -1;
    }
  }
  const main = segments.sort((leftSegment, rightSegment) => rightSegment.score - leftSegment.score)[0];
  const scale = width / analysis.info.width;
  let artworkBox = {
    left: Math.round(width * 0.25),
    top: Math.round(height * 0.37),
    width: Math.round(width * 0.5),
    height: Math.round(height * 0.28),
  };
  if (main) {
    const columnCounts = new Array(analysis.info.width).fill(0) as number[];
    for (let y = main.top; y < main.bottom; y += 1) {
      for (let x = roi.left; x < roi.right; x += 1) {
        const offset = (y * analysis.info.width + x) * analysis.info.channels;
        const luminance = analysis.data[offset] * 0.2126
          + analysis.data[offset + 1] * 0.7152
          + analysis.data[offset + 2] * 0.0722;
        if (luminance > 115) columnCounts[x] += 1;
      }
    }
    const activeColumns = columnCounts
      .map((count, x) => count >= Math.max(1, (main.bottom - main.top) * 0.008) ? x : -1)
      .filter((x) => x >= roi.left && x < roi.right);
    if (activeColumns.length) {
      const boxLeft = activeColumns[0];
      const boxRight = activeColumns[activeColumns.length - 1] + 1;
      artworkBox = {
        left: Math.round(boxLeft * scale),
        top: Math.round(main.top * scale),
        width: Math.max(1, Math.round((boxRight - boxLeft) * scale)),
        height: Math.max(1, Math.round((main.bottom - main.top) * scale)),
      };
    }
  }
  const artworkRatio = artworkBox.width / artworkBox.height;
  const targetRatio = artworkRatio >= 1.8 ? 16 / 9 : artworkRatio >= 0.9 ? 4 / 3 : 3 / 4;
  let cropWidth = Math.min(width, Math.round(artworkBox.width * 1.3));
  let cropHeight = Math.min(height, Math.round(artworkBox.height * 1.3));
  if (cropWidth / cropHeight < targetRatio) cropWidth = Math.min(width, Math.round(cropHeight * targetRatio));
  else cropHeight = Math.min(height, Math.round(cropWidth / targetRatio));
  const left = Math.max(0, Math.min(width - cropWidth, Math.round(artworkBox.left + artworkBox.width / 2 - cropWidth / 2)));
  const top = Math.max(0, Math.min(height - cropHeight, artworkBox.top));
  const outputWidth = targetRatio > 1 ? 2_048 : 1_536;
  const outputHeight = targetRatio >= 1.7 ? 1_152 : targetRatio > 1 ? 1_536 : 2_048;

  // Slot three is an exact optical crop of the approved front anchor. Keeping
  // AI out of this step guarantees that lettering and every print stroke stay
  // identical while still giving the CRM a genuinely different detail shot.
  return sharp(normalized.data)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize({ width: outputWidth, height: outputHeight, kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.7, m1: 0.5, m2: 1.5 })
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();
}
