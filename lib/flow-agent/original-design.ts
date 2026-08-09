export type OriginalDesignStage = "back-anchor" | "front-anchor" | "front-photo" | "front-detail" | "back-photo";

function extractAnchorConcept(basePrompt: string, side: "FRONT" | "BACK") {
  const normalized = basePrompt.replace(/\s+/g, " ").trim();
  const title = normalized.match(/(?:MARKET-GROUNDED ORIGINAL DESIGN|DEMAND-GROUNDED FALLBACK CONCEPT)[^.]*\./i)?.[0] || "";
  const sideStart = normalized.search(new RegExp(`\\b${side}:\\s*`, "i"));
  if (sideStart < 0) return title;
  const endMarker = side === "FRONT" ? /\sBACK:\s/i : /\s(?:PRODUCTION LOCK:|Do not reuse|LABEL CONSTRUCTION LOCK:)/i;
  const tail = normalized.slice(sideStart);
  const sideEnd = tail.search(endMarker);
  const brief = tail.slice(0, sideEnd > 0 ? sideEnd : Math.min(tail.length, 600)).trim();
  return [title, brief].filter(Boolean).join(" ");
}

export function buildOriginalFrontSeedPrompt(basePrompt: string) {
  return [
    "FRONT DESIGN SOURCE. Invent one new premium adult trap/archive short-sleeve T-shirt on a plain dark neutral studio background.",
    extractAnchorConcept(basePrompt, "FRONT"),
    "Show the entire washed-black shirt front with both sleeves, collar and hem. The artwork is one deliberate printable torso composition with strong hierarchy and black negative space, using absorbed off-white and deep oxblood ink.",
    "No existing stars, horse, animal, bird, owl, mascot, cartoon, moon, zodiac, flowers, esports logo, generic badge, watermark, marketplace UI, hang tag or fake brand name.",
    "This image is a DESIGN REFERENCE for a later product-photo edit, so make the new artwork unmistakable, commercially credible and fully visible.",
  ].filter(Boolean).join(" ");
}

export function buildOriginalStagePrompt(
  stage: OriginalDesignStage,
  basePrompt: string,
  referenceCount: number,
  options: { preserveWinnerLabel?: boolean; designReference?: boolean } = {},
) {
  const preserveWinnerLabel = options.preserveWinnerLabel === true;
  const designReference = options.designReference === true;
  const frontLabelRule = preserveWinnerLabel
    ? "WINNER LABEL LOCK: preserve the exact visible internal neck label or heat-transfer marking from the proven source garment. It may appear only on the inside back-neck panel when that inner panel is visible; reproduce its original pixels, lettering, proportions and placement. Never invent a substitute, hang tag, fastener or exterior label."
    : "ABSOLUTE LABEL LOCK: NO hang tag, paper tag, sewn label, woven tab, white locator, plastic fastener, string, cropped tag fragment or loose object at the collar. Do not generate L.G.B., a size mark or any label wording anywhere visible in this exterior product shot.";
  const conciseBrief = basePrompt
    .replace(/IMAGES?\s+\d+(?:-\d+)?[^.]*\./gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_400);
  if (stage === "front-anchor") {
    const anchorConcept = extractAnchorConcept(basePrompt, "FRONT");
    const sourceReferenceRule = designReference
      ? "IMAGE 1 is the APPROVED NEW DESIGN REFERENCE. Preserve its new artwork subject, hierarchy, ink palette and placement; ignore its studio background, garment folds, labels and any accidental text."
      : referenceCount > 0
      ? `IMAGES 1-${referenceCount} show the proven source garment. Learn only its garment construction, fabric and commercial hierarchy; do not copy its artwork, exterior text, brand marks, marketplace background or watermark.`
      : "The proven marketplace photos were analyzed before this generation and are NOT attached. Follow the approved production brief for the new garment; do not invent or reproduce any marketplace background, listing overlay or watermark.";
    const sceneReferenceNumber = referenceCount + 1;
    const frontAnchorLabelRule = preserveWinnerLabel && (referenceCount === 0 || designReference)
      ? "WINNER LABEL LOCK — LABEL POSTPROCESS: leave the visible inside back-neck panel clean and blank, with no letters, logo or invented marking. The program applies the winner's exact extracted marking after generation. Never add a hang tag, fastener, string or exterior label."
      : frontLabelRule;
    return [
      "FRONT DESIGN ANCHOR. Create the unmistakable FRONT view of ONE new premium archive-fashion garment.",
      "GARMENT TYPE LOCK: this product is a flat short-sleeve T-shirt with two complete short sleeves. Ignore any long-sleeve, longsleeve or sweatshirt wording inherited from marketplace research; never generate a long-sleeve top or sweatshirt.",
      "Render the approved front subject from the production brief literally; never replace it with an unrelated stock image, generic emblem, logo-core mark or abstract block.",
      anchorConcept,
      conciseBrief,
      sourceReferenceRule,
      `IMAGE ${sceneReferenceNumber} is the ONLY SCENE REFERENCE: copy its exact surface, seams, folds, crop, perspective, camera and light. No other background is allowed. Ignore any garment, print, label and text visible in it.`,
      preserveWinnerLabel
        ? referenceCount === 0 || designReference
          ? "FRONT anatomy is mandatory: keep a clean crew neck and expose enough of the blank inside back-neck panel for the programmatic winner-label overlay. Never place any label text on the outer chest."
          : "FRONT anatomy is mandatory: keep a clean crew neck and expose enough of the inside back-neck panel to show the source winner's exact internal marking. Never place it on the outer chest."
        : "FRONT anatomy is mandatory: keep a clean crew neck. The garment has only an internal heat-transfer neck marking on the inside back-neck panel, physically hidden unless that inner panel is genuinely visible. Never place label text on the outer chest.",
      frontAnchorLabelRule,
      "Follow the approved FRONT artwork in the production brief exactly. It needs a recognizable editorial subject and intentional hierarchy, not abstract squares, rectangles, grids, tiled blocks, a lone chest logo or decorative geometry.",
      "COMMERCIAL TASTE LOCK: no radial ring of repeated objects, eye/oval/swoosh emblem, lone number on a blob, tiny centered token, esports/tech identity, arbitrary badge, invented brand name, holographic foil or glossy vinyl. Any required words must match the brief exactly and be legible.",
      "PRINTABILITY IS MANDATORY: the complete front artwork must fit one rectangle no larger than 24 x 32 cm, entirely on the flat torso panel and at least 5 cm from collar, shoulders, sleeves, side seams and hem. No all-over, wraparound, sleeve, seam-crossing or edge-to-edge print.",
      "ADULT STREETWEAR LOCK: no animals, birds, owls, insects, mascots, fantasy creatures, moon/zodiac/tarot imagery, flowers, botanical branches, cute faces, cartoons, children's-merch storytelling or unrelated stock clipart.",
      "ZERO WATERMARKS: no Avito, Grailed, marketplace logo, listing overlay, seller mark, signature or corner watermark anywhere in the output.",
      "Return one photorealistic FRONT-view product photo only. Do not show the back.",
    ].join(" ");
  }
  if (stage === "back-anchor") {
    const anchorConcept = extractAnchorConcept(basePrompt, "BACK");
    return [
      "BACK DESIGN ANCHOR. TURN THE NEW GARMENT OVER and show its unmistakable REAR side. This is not another photo of the front. NO VISIBLE LABEL OR LABEL TEXT may appear outside below the rear collar; the internal heat-transfer marking is physically hidden inside the garment.",
      "GARMENT TYPE LOCK: this is the same flat short-sleeve T-shirt with two complete short sleeves. Ignore any long-sleeve, longsleeve or sweatshirt wording inherited from marketplace research.",
      "Render the approved back subject from the production brief literally; never replace it with an unrelated stock image, generic emblem, logo-core mark or abstract block.",
      anchorConcept,
      conciseBrief,
      "IMAGE 1 is the new FRONT ANCHOR whose garment color, cut and visual language define the same new product.",
      "IMAGE 2 is SCENE ONLY: copy surface, camera and light; ignore its garment and every marking.",
      "REAR anatomy is mandatory: use the higher closed back neckline. The inside heat-transfer neck marking is physically inside the shirt and therefore NOT visible from the rear. Never add a hang tag, paper tag, sewn label, woven tab, white locator, plastic fastener, string, cropped tag fragment, L.G.B., CUSTOM MADE or label wording on the exterior.",
      "Follow the approved BACK artwork in the production brief exactly. It must develop the same story and ink palette while using a different primary subject and silhouette from the front; never repeat, mirror, enlarge, fragment or paste the front artwork.",
      "The supporting side must still look deliberately designed and sellable, never one tiny token below the collar. No radial ring, eye/oval/swoosh, lone number and blob, esports/tech badge, invented brand, holographic foil or fake text.",
      "PRINTABILITY IS MANDATORY: the complete back artwork must fit one rectangle no larger than 24 x 32 cm, entirely on the flat torso panel and at least 5 cm from collar, shoulders, sleeves, side seams and hem. No all-over, tiled, wraparound, sleeve, seam-crossing or edge-to-edge print.",
      "ADULT STREETWEAR LOCK: no animals, birds, owls, insects, mascots, fantasy creatures, moon/zodiac/tarot imagery, flowers, botanical branches, cute faces, cartoons, children's-merch storytelling or unrelated stock icon.",
      "Return one photorealistic BACK-view product photo only. Do not show the front neckline or front artwork.",
    ].join(" ");
  }
  if (stage === "front-detail") {
    return [
      "FINAL FRONT PRINT DETAIL. IMAGE 1 is the immutable front anchor of the newly designed garment; preserve every artwork pixel, shape, ink colour, distress mark, proportion and placement exactly. Never redraw, simplify, extend, mirror or repair the print.",
      "IMAGE 2 is SCENE ONLY: reproduce only its surface, perspective and light; ignore its garment, print, label, text and objects.",
      "REAL CAMERA COMPOSITION LOCK: create a genuinely new close three-quarter product photograph, never a digital crop of IMAGE 1 and never a texture-only macro. The complete print must occupy roughly 35-50% of the frame and remain fully visible.",
      "Keep enough product context to look like a real marketplace photo: show the collar, at least one complete sleeve, one side or hem edge, natural folds and a clearly visible band of the supplied background around the garment. Do not cut through any artwork element.",
      frontLabelRule,
      "Show absorbed ink edges, halftone texture, fine cracking and real cotton fibres in sharp focus. Keep realistic oblique perspective, micro-wrinkles and soft grazing light; no blur over artwork, patch, cleanup smear, CGI, watermark or extra object.",
      "Return one sharp photorealistic close product photo only, with garment and background visibly present.",
    ].join(" ");
  }
  const side = stage === "front-photo" ? "front" : "back";
  return [
    `FINAL ${side.toUpperCase()} PHOTO. IMAGE 1 is the immutable ${side} anchor of the newly designed garment; preserve it exactly, pixel-faithfully: cut, color, seams, every graphic shape, placement and distress. Do not invent or relocate any neck-label pixels.`,
    "IMAGE 2 is SCENE ONLY: reproduce only its surface, perspective, crop and light; ignore its garment, print, label, text and objects.",
    side === "front"
      ? preserveWinnerLabel
        ? "It must remain a FRONT view. Preserve the source winner's exact internal neck marking on the visible inside back-neck panel while keeping the outer chest free of label text. Never add a hang tag, fastener, string or exterior label."
        : "It must remain a FRONT view with a clean crew-neck shape. The internal heat-transfer marking is hidden inside the back-neck panel. Keep collar ribbing and upper external chest free of every label mark. NO hang tag, paper tag, sewn label, woven tab, white locator, fastener, string, cropped tag fragment, L.G.B. or size text may be visible."
      : "It must remain a BACK view with a higher closed rear neckline. The internal heat-transfer marking is hidden inside. NO hang tag, paper tag, sewn label, woven tab, white locator, fastener, string, cropped tag fragment, L.G.B. or label wording may be visible.",
    "SHOT DIVERSITY LOCK: this image must be visibly different from IMAGE 1 in camera side, oblique perspective, garment rotation and fold silhouette. A near-identical overhead duplicate is forbidden.",
    "Change only natural placement, folds and camera angle. Never redesign, mirror, add, remove, simplify or hide product details.",
    "Real cotton weave, absorbed ink, gravity and contact shadows; no CGI, pasted edges, props, watermarks or extra garments. Return one sharp photorealistic marketplace photo.",
  ].join(" ");
}
