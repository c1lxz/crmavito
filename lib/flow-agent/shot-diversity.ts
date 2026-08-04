import sharp from "sharp";

export type ShotDiversityVerdict = {
  pass: boolean;
  meanAbsoluteDifference: number;
  correlation: number;
  issue?: string;
};

export async function evaluateShotDiversity(
  anchorPath: string,
  candidatePath: string,
): Promise<ShotDiversityVerdict> {
  const [anchor, candidate] = await Promise.all([
    normalizedThumbnail(anchorPath),
    normalizedThumbnail(candidatePath),
  ]);
  let absoluteDifference = 0;
  let anchorMean = 0;
  let candidateMean = 0;
  for (let index = 0; index < anchor.length; index += 1) {
    absoluteDifference += Math.abs(anchor[index] - candidate[index]);
    anchorMean += anchor[index];
    candidateMean += candidate[index];
  }
  anchorMean /= anchor.length;
  candidateMean /= candidate.length;
  let covariance = 0;
  let anchorVariance = 0;
  let candidateVariance = 0;
  for (let index = 0; index < anchor.length; index += 1) {
    const anchorDelta = anchor[index] - anchorMean;
    const candidateDelta = candidate[index] - candidateMean;
    covariance += anchorDelta * candidateDelta;
    anchorVariance += anchorDelta * anchorDelta;
    candidateVariance += candidateDelta * candidateDelta;
  }
  const meanAbsoluteDifference = absoluteDifference / anchor.length;
  const correlation = covariance / Math.max(1, Math.sqrt(anchorVariance * candidateVariance));
  const pass = meanAbsoluteDifference > 3 || correlation < 0.997;
  return {
    pass,
    meanAbsoluteDifference,
    correlation,
    ...(pass ? {} : {
      issue: "The new shot is a near-duplicate of the anchor. Use the required different camera side, oblique perspective and visibly changed garment silhouette while preserving the same product.",
    }),
  };
}

async function normalizedThumbnail(filePath: string) {
  return sharp(filePath)
    .rotate()
    .resize(64, 64, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
}
