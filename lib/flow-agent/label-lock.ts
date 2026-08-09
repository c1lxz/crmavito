import { rename } from "node:fs/promises";
import sharp from "sharp";

type LabelCandidate = {
  sourcePath: string;
  crop: Buffer;
  score: number;
};

export async function createBestLabelAssets(
  sourcePaths: string[],
  referencePath: string,
  overlayPath: string,
) {
  if (!sourcePaths.length) throw new Error("No product photos are available for the neck-label lock.");
  const candidates = (await Promise.all(sourcePaths.map(createLabelCandidate)))
    .sort((left, right) => right.score - left.score);
  let selected: { candidate: LabelCandidate; overlay: Buffer } | undefined;
  for (const candidate of candidates) {
    const metadata = await sharp(candidate.crop).metadata();
    const width = metadata.width || 1;
    const height = metadata.height || 1;
    const tightLeft = Math.max(0, Math.round(width * 0.10));
    const tightTop = Math.max(0, Math.round(height * 0.25));
    const tight = await sharp(candidate.crop)
      .extract({
        left: tightLeft,
        top: tightTop,
        width: Math.min(Math.max(1, Math.round(width * 0.80)), width - tightLeft),
        height: Math.min(Math.max(1, Math.round(height * 0.75)), height - tightTop),
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const overlay = await extractBestLabelOverlay(tight.data, tight.info);
    if (overlay) {
      selected = { candidate, overlay };
      break;
    }
  }
  if (!selected) {
    throw new Error("The winner photo does not show a usable internal neck label or heat-transfer marking.");
  }
  await sharp(selected.candidate.crop).resize({ width: 1_200, withoutEnlargement: true }).png().toFile(referencePath);
  await sharp(selected.overlay).png().toFile(overlayPath);
  return { sourcePath: selected.candidate.sourcePath, score: selected.candidate.score };
}

export async function hasExtractableWinnerLabel(input: Buffer) {
  const candidate = await createLabelCandidateFromBuffer(input, "buffer");
  const metadata = await sharp(candidate.crop).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const tight = await sharp(candidate.crop)
    .extract({
      left: Math.max(0, Math.round(width * 0.10)),
      top: Math.max(0, Math.round(height * 0.25)),
      width: Math.min(Math.max(1, Math.round(width * 0.80)), width - Math.max(0, Math.round(width * 0.10))),
      height: Math.min(Math.max(1, Math.round(height * 0.75)), height - Math.max(0, Math.round(height * 0.25))),
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Boolean(await extractBestLabelOverlay(tight.data, tight.info));
}

async function extractBestLabelOverlay(
  source: Buffer,
  info: { width: number; height: number; channels: 1 | 2 | 3 | 4 },
) {
  const candidates: Array<{ overlay: Buffer; strongPixels: number; area: number }> = [];
  for (const polarity of ["light", "dark"] as const) {
    const pixels = Buffer.from(source);
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = Math.round(0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]);
      pixels[index + 3] = polarity === "light"
        ? Math.max(0, Math.min(255, (luminance - 135) * 3))
        : Math.max(0, Math.min(255, (120 - luminance) * 3));
    }
    keepLowerLabelComponents(pixels, info.width, info.height);
    const overlay = await finalizeLabelOverlay(pixels, info);
    const strongPixels = await countMeaningfulLabelPixels(overlay);
    const metadata = await sharp(overlay).metadata();
    const overlayWidth = metadata.width || info.width;
    const overlayHeight = metadata.height || info.height;
    // A collar mark is compact. A broad candidate is upholstery/collar fabric
    // selected by the inverse polarity, not printable label pixels.
    if (strongPixels >= 40 && overlayWidth <= info.width * 0.65 && overlayHeight <= info.height * 0.70) {
      candidates.push({ overlay, strongPixels, area: overlayWidth * overlayHeight });
    }
  }
  return candidates.sort((left, right) => (
    right.strongPixels / Math.sqrt(right.area) - left.strongPixels / Math.sqrt(left.area)
  ))[0]?.overlay;
}

export async function measureLabelBaselineAngle(input: Buffer) {
  const raw = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let weight = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < raw.info.height; y += 1) {
    for (let x = 0; x < raw.info.width; x += 1) {
      const alpha = raw.data[(y * raw.info.width + x) * 4 + 3] / 255;
      weight += alpha;
      sumX += x * alpha;
      sumY += y * alpha;
    }
  }
  if (weight < 1) return 0;
  const meanX = sumX / weight;
  const meanY = sumY / weight;
  let varianceX = 0;
  let varianceY = 0;
  let covariance = 0;
  for (let y = 0; y < raw.info.height; y += 1) {
    for (let x = 0; x < raw.info.width; x += 1) {
      const alpha = raw.data[(y * raw.info.width + x) * 4 + 3] / 255;
      varianceX += (x - meanX) ** 2 * alpha;
      varianceY += (y - meanY) ** 2 * alpha;
      covariance += (x - meanX) * (y - meanY) * alpha;
    }
  }
  return 0.5 * Math.atan2(2 * covariance, varianceX - varianceY) * 180 / Math.PI;
}

export async function straightenLabelOverlay(input: Buffer) {
  const measured = await measureLabelBaselineAngle(input);
  const correction = Math.max(-20, Math.min(20, measured));
  if (Math.abs(correction) < 0.75) return sharp(input).png().toBuffer();
  return sharp(input)
    .rotate(-correction, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 4 })
    .png()
    .toBuffer();
}

export async function applyExactLabelOverlay(outputPath: string, overlayPath: string) {
  const output = sharp(outputPath).rotate();
  const metadata = await output.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) throw new Error("Generated product has no usable dimensions for the label lock.");
  const rawOutput = await sharp(outputPath).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const detectedLabels = findGeneratedLabelBoundsCandidates(rawOutput.data, width, height, rawOutput.info.channels);
  const detected = detectedLabels[0];
  const targetWidth = Math.max(40, Math.round(detected ? detected.width * 1.02 : width * 0.055));
  let overlay = await sharp(overlayPath).resize({ width: targetWidth, withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true });
  // Approved CRM packshots use an oblique composition with the collar shifted
  // slightly right of the canvas centre. Keep detected marks exact, but place
  // a clean fallback on that rear-neck panel instead of the left collar rim.
  const centerX = detected ? detected.left + detected.width / 2 : width * 0.56;
  // On a clean front photo there is no generated mark to replace. Place the
  // exact transfer inside the rear neck panel, below the collar rim. The old
  // 22.5% fallback landed on the upper rim/background in oblique CRM shots.
  const centerY = detected ? detected.top + detected.height / 2 : height * 0.255;
  const left = Math.max(0, Math.min(width - overlay.info.width, Math.round(centerX - overlay.info.width / 2)));
  const top = Math.max(0, Math.min(height - overlay.info.height, Math.round(centerY - overlay.info.height / 2)));
  overlay = await ensureLabelContrast(overlay.data, outputPath, left, top);
  // A clean generated neck panel needs no fabric patch. Cover only a detected
  // temporary/generated mark; a fallback patch creates a visible rectangle on
  // otherwise clean black cotton.
  const covers = await Promise.all(detectedLabels.map((bounds) => createLabelCover(outputPath, bounds, width, height)));
  const temporaryPath = `${outputPath}.label-lock.jpg`;
  const composited = output.composite([
    ...covers,
    { input: overlay.data, left, top },
  ]);
  if (metadata.format === "png") {
    await composited.png({ compressionLevel: 7 }).toFile(temporaryPath);
  } else {
    await composited.jpeg({ quality: 96, chromaSubsampling: "4:4:4" }).toFile(temporaryPath);
  }
  await rename(temporaryPath, outputPath);
}

async function ensureLabelContrast(overlay: Buffer, outputPath: string, left: number, top: number) {
  const mark = await sharp(overlay).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const fabric = await sharp(outputPath)
    .rotate()
    .extract({ left, top, width: mark.info.width, height: mark.info.height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let markLuminance = 0;
  let markWeight = 0;
  let fabricLuminance = 0;
  for (let index = 0, pixel = 0; index < mark.data.length; index += 4, pixel += fabric.info.channels) {
    const alpha = mark.data[index + 3] / 255;
    if (alpha < 0.08) continue;
    markLuminance += (0.2126 * mark.data[index] + 0.7152 * mark.data[index + 1] + 0.0722 * mark.data[index + 2]) * alpha;
    fabricLuminance += (0.2126 * fabric.data[pixel] + 0.7152 * fabric.data[pixel + 1] + 0.0722 * fabric.data[pixel + 2]) * alpha;
    markWeight += alpha;
  }
  if (!markWeight || Math.abs(markLuminance / markWeight - fabricLuminance / markWeight) >= 75) {
    return sharp(mark.data, { raw: mark.info }).png().toBuffer({ resolveWithObject: true });
  }
  const ink = fabricLuminance / markWeight < 128 ? 238 : 20;
  const pixels = Buffer.from(mark.data);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 8) continue;
    pixels[index] = ink;
    pixels[index + 1] = ink;
    pixels[index + 2] = ink;
  }
  return sharp(pixels, { raw: mark.info }).png().toBuffer({ resolveWithObject: true });
}

export function findGeneratedLabelBounds(data: Buffer, width: number, height: number, channels = 3) {
  return findGeneratedLabelBoundsCandidates(data, width, height, channels)[0];
}

export function findGeneratedLabelBoundsCandidates(data: Buffer, width: number, height: number, channels = 3) {
  // The Flow packshot keeps the inner neck label in this narrow central band.
  // Keeping the detector out of the chest area is critical: distressed artwork
  // often contains brighter strokes that otherwise look more "text-like" than
  // the small generated label.
  // Oblique photos can move the collar far away from the frame centre.
  const minimumX = Math.round(width * 0.20);
  const maximumX = Math.round(width * 0.80);
  const minimumY = Math.round(height * 0.08);
  // A neck mark must stay inside the top quarter of a front-facing packshot.
  // Anything lower is an exterior duplicate or chest artwork and is never a
  // valid replacement target.
  const maximumY = Math.round(height * 0.26);
  const radius = Math.max(3, Math.round(width * 0.006));
  const pointsByRow: number[][] = Array.from({ length: height }, () => []);
  const luminanceAt = (x: number, y: number) => {
    const index = (y * width + x) * channels;
    return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  };
  const offsets = [[-radius, 0], [radius, 0], [0, -radius], [0, radius], [-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]];
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      if (luminanceAt(x, y) < 155) continue;
      const darkNeighbors = offsets.reduce((count, [offsetX, offsetY]) => {
        const nextX = Math.max(0, Math.min(width - 1, x + offsetX));
        const nextY = Math.max(0, Math.min(height - 1, y + offsetY));
        return count + (luminanceAt(nextX, nextY) < 105 ? 1 : 0);
      }, 0);
      if (darkNeighbors >= 4) pointsByRow[y].push(x);
    }
  }
  const rowWindow = Math.max(8, Math.round(height * 0.025));
  const candidates: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (let candidateIndex = 0; candidateIndex < 3; candidateIndex += 1) {
    let bestRowStart = minimumY;
    let bestRowCount = 0;
    let rollingRows = 0;
    for (let y = minimumY; y <= maximumY; y += 1) {
      rollingRows += pointsByRow[y].length;
      if (y - rowWindow >= minimumY) rollingRows -= pointsByRow[y - rowWindow].length;
      if (rollingRows > bestRowCount) {
        bestRowCount = rollingRows;
        bestRowStart = Math.max(minimumY, y - rowWindow + 1);
      }
    }
    if (bestRowCount < 30) break;
    const rowPoints = pointsByRow.slice(bestRowStart, bestRowStart + rowWindow)
      .flatMap((xs, rowOffset) => xs.map((x) => ({ x, y: bestRowStart + rowOffset })));
    const columnCounts = new Uint32Array(width);
    rowPoints.forEach((point) => { columnCounts[point.x] += 1; });
    const columnWindow = Math.max(20, Math.round(width * 0.18));
    let bestColumnStart = minimumX;
    let bestColumnCount = 0;
    let rollingColumns = 0;
    for (let x = minimumX; x <= maximumX; x += 1) {
      rollingColumns += columnCounts[x];
      if (x - columnWindow >= minimumX) rollingColumns -= columnCounts[x - columnWindow];
      if (rollingColumns > bestColumnCount) {
        bestColumnCount = rollingColumns;
        bestColumnStart = Math.max(minimumX, x - columnWindow + 1);
      }
    }
    const selected = rowPoints.filter((point) => point.x >= bestColumnStart && point.x < bestColumnStart + columnWindow);
    if (selected.length < 30) break;
    const activeThreshold = 2;
    const activeColumns = Array.from({ length: columnWindow }, (_, offset) => bestColumnStart + offset)
      .filter((x) => columnCounts[x] >= activeThreshold);
    const groups: number[][] = [];
    const maximumGap = Math.max(4, Math.round(radius * 2.5));
    for (const x of activeColumns) {
      const current = groups.at(-1);
      if (!current || x - current.at(-1)! > maximumGap) groups.push([x]);
      else current.push(x);
    }
    const bestGroup = groups.sort((left, right) => {
      const leftScore = left.reduce((score, x) => score + columnCounts[x], 0);
      const rightScore = right.reduce((score, x) => score + columnCounts[x], 0);
      return rightScore - leftScore;
    })[0];
    if (!bestGroup) break;
    const groupLeft = bestGroup[0] - radius;
    const groupRight = bestGroup.at(-1)! + radius;
    const textPoints = selected.filter((point) => point.x >= groupLeft && point.x <= groupRight);
    if (textPoints.length < 24) break;
    const left = Math.min(...textPoints.map((point) => point.x));
    const right = Math.max(...textPoints.map((point) => point.x));
    const top = Math.min(...textPoints.map((point) => point.y));
    const bottom = Math.max(...textPoints.map((point) => point.y));
    const bounds = { left, top, width: right - left + 1, height: bottom - top + 1 };
    const aspect = bounds.width / Math.max(1, bounds.height);
    const centerRatio = (bounds.left + bounds.width / 2) / width;
    if (aspect >= 1.15 && centerRatio >= 0.38 && centerRatio <= 0.62 && bounds.width <= width * 0.14 && bounds.height <= height * 0.06) candidates.push(bounds);
    const padding = Math.round(rowWindow * 0.35);
    for (let y = Math.max(minimumY, top - padding); y <= Math.min(maximumY, bottom + padding); y += 1) {
      pointsByRow[y] = [];
    }
  }
  return candidates.sort((left, right) => left.top - right.top);
}

async function createLabelCover(
  outputPath: string,
  bounds: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
) {
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const coverWidth = Math.max(Math.round(bounds.width * 1.55), Math.round(width * 0.082));
  const coverHeight = Math.max(Math.round(bounds.height * 1.55), Math.round(height * 0.036));
  const coverLeft = Math.max(0, Math.min(width - coverWidth, Math.round(centerX - coverWidth / 2)));
  const coverTop = Math.max(0, Math.min(height - coverHeight, Math.round(centerY - coverHeight / 2)));
  const sourceGap = Math.round(width * 0.02);
  const sourceCandidates = [
    { left: coverLeft - coverWidth - sourceGap, top: coverTop },
    { left: coverLeft + coverWidth + sourceGap, top: coverTop },
    { left: coverLeft, top: coverTop - coverHeight - sourceGap },
    { left: coverLeft, top: coverTop + coverHeight + sourceGap },
  ].filter(({ left, top }) => left >= 0 && top >= 0 && left + coverWidth <= width && top + coverHeight <= height);
  const patches = await Promise.all(sourceCandidates.map(async ({ left, top }) => {
    const patch = await sharp(outputPath)
      .extract({ left, top, width: coverWidth, height: coverHeight })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let luminance = 0;
    let brightPixels = 0;
    for (let index = 0; index < patch.data.length; index += patch.info.channels) {
      const value = 0.2126 * patch.data[index] + 0.7152 * patch.data[index + 1] + 0.0722 * patch.data[index + 2];
      luminance += value;
      if (value > 140) brightPixels += 1;
    }
    const pixelCount = patch.info.width * patch.info.height;
    return { ...patch, score: brightPixels / pixelCount * 1_000 + luminance / pixelCount };
  }));
  const cleanest = patches.sort((left, right) => left.score - right.score)[0];
  if (!cleanest) throw new Error("Could not find a clean fabric patch for neck-label cleanup.");
  const cloned = await sharp(cleanest.data, { raw: cleanest.info })
    .blur(2)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(cloned.data);
  for (let y = 0; y < cloned.info.height; y += 1) {
    for (let x = 0; x < cloned.info.width; x += 1) {
      const dx = (x - cloned.info.width / 2) / (cloned.info.width / 2);
      const dy = (y - cloned.info.height / 2) / (cloned.info.height / 2);
      const edgeDistance = Math.max(Math.abs(dx), Math.abs(dy));
      const feather = edgeDistance <= 0.65 ? 1 : Math.max(0, (1 - edgeDistance) / 0.35);
      pixels[(y * cloned.info.width + x) * 4 + 3] = Math.round(255 * feather);
    }
  }
  return { input: await sharp(pixels, { raw: cloned.info }).png().toBuffer(), left: coverLeft, top: coverTop };
}

async function createLabelCandidate(sourcePath: string): Promise<LabelCandidate> {
  return createLabelCandidateFromBuffer(await sharp(sourcePath).toBuffer(), sourcePath);
}

async function createLabelCandidateFromBuffer(input: Buffer, sourcePath: string): Promise<LabelCandidate> {
  const normalized = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
  const cropWidth = Math.max(1, Math.round(normalized.info.width * 0.55));
  const cropHeight = Math.max(1, Math.round(normalized.info.height * 0.20));
  const left = Math.max(0, Math.round((normalized.info.width - cropWidth) / 2));
  const crop = await sharp(normalized.data).extract({ left, top: 0, width: cropWidth, height: cropHeight }).toBuffer();
  const edge = await sharp(crop).resize({ width: 600 }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { sourcePath, crop, score: laplacianVariance(edge.data, edge.info.width, edge.info.height) };
}

async function finalizeLabelOverlay(
  pixels: Buffer,
  info: { width: number; height: number; channels: 1 | 2 | 3 | 4 },
) {
  const extracted = await sharp(pixels, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toBuffer();
  return straightenLabelOverlay(extracted);
}

async function hasMeaningfulLabelPixels(input: Buffer) {
  return (await countMeaningfulLabelPixels(input)) >= 40;
}

async function countMeaningfulLabelPixels(input: Buffer) {
  const raw = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let strongPixels = 0;
  for (let index = 3; index < raw.data.length; index += 4) {
    if (raw.data[index] >= 80) strongPixels += 1;
  }
  return strongPixels;
}

export function laplacianVariance(data: Buffer, width: number, height: number) {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value = 4 * data[index] - data[index - 1] - data[index + 1] - data[index - width] - data[index + width];
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

function keepLowerLabelComponents(pixels: Buffer, width: number, height: number) {
  const visited = new Uint8Array(width * height);
  const keep = new Uint8Array(width * height);
  const minimumY = Math.round(height * 0.08);
  const components: Array<{
    pixels: number[];
    left: number;
    right: number;
    top: number;
    bottom: number;
  }> = [];
  for (let seed = 0; seed < visited.length; seed += 1) {
    if (visited[seed] || pixels[seed * 4 + 3] < 80) continue;
    const queue = [seed];
    const component: number[] = [];
    let cursor = 0;
    let left = width;
    let right = 0;
    let top = height;
    let bottom = 0;
    visited[seed] = 1;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (!visited[next] && pixels[next * 4 + 3] >= 80) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    components.push({ pixels: component, left, right, top, bottom });
  }
  const anchors = components.filter((component) => (
    component.pixels.length >= 40
    && component.pixels.length <= width * height * 0.35
    && component.top >= minimumY
  ));
  for (const component of components) {
    const belongsToLabel = component.pixels.length >= 3 && anchors.some((anchor) => {
      const horizontalPadding = Math.max(width * 0.10, (anchor.right - anchor.left + 1) * 2.5);
      const verticalPaddingAbove = Math.max(2, height * 0.04);
      const verticalPaddingBelow = Math.max(height * 0.34, (anchor.bottom - anchor.top + 1) * 3);
      return component.right >= anchor.left - horizontalPadding
        && component.left <= anchor.right + horizontalPadding
        && component.bottom >= anchor.top - verticalPaddingAbove
        && component.top <= anchor.bottom + verticalPaddingBelow;
    });
    if (belongsToLabel) component.pixels.forEach((index) => { keep[index] = 1; });
  }
  for (let index = 0; index < keep.length; index += 1) {
    if (!keep[index]) pixels[index * 4 + 3] = 0;
  }
}
