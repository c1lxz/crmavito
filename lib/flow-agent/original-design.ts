export type OriginalDesignStage = "back-anchor" | "front-anchor" | "front-photo" | "front-detail" | "back-photo";

export function buildOriginalStagePrompt(stage: OriginalDesignStage, basePrompt: string, referenceCount: number) {
  const usesNightVeilFallback = /NIGHT VEIL/i.test(basePrompt);
  const conciseBrief = basePrompt
    .replace(/IMAGES?\s+\d+(?:-\d+)?[^.]*\./gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_400);
  if (stage === "front-anchor") {
    return [
      "FRONT DESIGN ANCHOR. Create the unmistakable FRONT view of ONE new premium archive-fashion garment.",
      usesNightVeilFallback
        ? "MANDATORY FRONT ARTWORK — NIGHT VEIL: a 12 x 16 cm isolated handmade cross assembled from four fractured bone-like strokes, loosely bound at the center by one thin wine-red thread, with sparse smoke-grey broken web-line fragments interrupting the silhouette. At least 75% of the artwork bounding area must remain untouched black shirt. ABSOLUTELY NO square, rectangle, straight crop edge, solid cream field, white field, poster, photo panel, words, badge, box, background fill, animal, star or horse artwork. It must feel like a rare 2000s Japanese alternative-rock tee, not a church souvenir, stock gothic icon, logo or random geometry."
        : "Render the approved front subject from the production brief literally; never replace it with an unrelated stock image, rectangular photo panel or abstract block.",
      ...(usesNightVeilFallback ? [] : [conciseBrief]),
      `IMAGES 1-${referenceCount} show the proven source garment. Learn only its garment construction, fabric and commercial hierarchy; do not copy its artwork, exterior text or brand marks.`,
      `IMAGE ${referenceCount + 1} is SCENE ONLY: copy its exact surface, camera and light; ignore its garment, print, label and text.`,
      "FRONT anatomy is mandatory: keep a clean crew neck. The garment has only an internal heat-transfer neck marking on the inside back-neck panel, physically hidden unless that inner panel is genuinely visible. Never place label text on the outer chest.",
      "ABSOLUTE LABEL LOCK: NO hang tag, paper tag, sewn label, woven tab, white locator, plastic fastener, string, cropped tag fragment or loose object at the collar. Do not generate L.G.B., a size mark or any label wording anywhere visible in this exterior product shot.",
      "Follow the approved FRONT artwork in the production brief exactly. It needs a recognizable editorial subject and intentional hierarchy, not abstract squares, rectangles, grids, tiled blocks, a lone chest logo or decorative geometry.",
      "PRINTABILITY IS MANDATORY: the complete front artwork must fit one rectangle no larger than 24 x 32 cm, entirely on the flat torso panel and at least 5 cm from collar, shoulders, sleeves, side seams and hem. No all-over, wraparound, sleeve, seam-crossing or edge-to-edge print.",
      "No generic animals, winner stars, horse/equine figure, buffalo/yak/bear/wolf or unrelated stock clipart.",
      "Return one photorealistic FRONT-view product photo only. Do not show the back.",
    ].join(" ");
  }
  if (stage === "back-anchor") {
    return [
      "BACK DESIGN ANCHOR. TURN THE NEW GARMENT OVER and show its unmistakable REAR side. This is not another photo of the front. NO VISIBLE LABEL OR LABEL TEXT may appear outside below the rear collar; the internal heat-transfer marking is physically hidden inside the garment.",
      usesNightVeilFallback
        ? "MANDATORY BACK ARTWORK — NIGHT VEIL: a 22 x 30 cm vertical three-quarter human skull profile, visibly fractured and partly erased, caught in sparse broken spider-silk linework with one incomplete wine-red halo slash. Build it from separated bone-grey halftone fragments and keep at least 60% of the bounding area as untouched black shirt. No spider body, solid light field, readable text, animal, star, horse, box, border, background fill or rectangular photo edge. It must feel like a rare Japanese archive-rock graphic, not fantasy clipart or a generic biker skull."
        : "Render the approved back subject from the production brief literally; never replace it with an unrelated stock image, rectangular photo panel or abstract block.",
      ...(usesNightVeilFallback ? [] : [conciseBrief]),
      "IMAGE 1 is the new FRONT ANCHOR whose garment color, cut and visual language define the same new product.",
      "IMAGE 2 is SCENE ONLY: copy surface, camera and light; ignore its garment and every marking.",
      "REAR anatomy is mandatory: use the higher closed back neckline. The inside heat-transfer neck marking is physically inside the shirt and therefore NOT visible from the rear. Never add a hang tag, paper tag, sewn label, woven tab, white locator, plastic fastener, string, cropped tag fragment, L.G.B., CUSTOM MADE or label wording on the exterior.",
      "Follow the approved BACK artwork in the production brief exactly. It must develop the same story and ink palette while using a different primary subject and silhouette from the front; never repeat, mirror, enlarge, fragment or paste the front artwork.",
      "PRINTABILITY IS MANDATORY: the complete back artwork must fit one rectangle no larger than 24 x 32 cm, entirely on the flat torso panel and at least 5 cm from collar, shoulders, sleeves, side seams and hem. No all-over, tiled, wraparound, sleeve, seam-crossing or edge-to-edge print.",
      "No random abstract squares, rectangles, grids, generic mascot, winner stars, horse/equine artwork, buffalo/yak/bear/wolf or unrelated stock icon.",
      "Return one photorealistic BACK-view product photo only. Do not show the front neckline or front artwork.",
    ].join(" ");
  }
  if (stage === "front-detail") {
    return [
      "FINAL FRONT PRINT DETAIL. IMAGE 1 is the immutable front anchor of the newly designed garment; preserve every artwork pixel, shape, ink colour, distress mark, proportion and placement exactly. Never redraw, simplify, extend, mirror or repair the print.",
      "IMAGE 2 is SCENE ONLY: reproduce only its surface, perspective and light; ignore its garment, print, label, text and objects.",
      "REAL CAMERA COMPOSITION LOCK: create a genuinely new close three-quarter product photograph, never a digital crop of IMAGE 1 and never a texture-only macro. The complete print must occupy roughly 35-50% of the frame and remain fully visible.",
      "Keep enough product context to look like a real marketplace photo: show the collar, at least one complete sleeve, one side or hem edge, natural folds and a clearly visible band of the supplied background around the garment. Do not cut through any artwork element.",
      "The collar is clean. NO hang tag, paper tag, sewn label, woven tab, white locator, plastic fastener, string, cropped tag fragment, L.G.B. or other label wording may be visible.",
      "Show absorbed ink edges, halftone texture, fine cracking and real cotton fibres in sharp focus. Keep realistic oblique perspective, micro-wrinkles and soft grazing light; no blur over artwork, patch, cleanup smear, CGI, watermark or extra object.",
      "Return one sharp photorealistic close product photo only, with garment and background visibly present.",
    ].join(" ");
  }
  const side = stage === "front-photo" ? "front" : "back";
  return [
    `FINAL ${side.toUpperCase()} PHOTO. IMAGE 1 is the immutable ${side} anchor of the newly designed garment; preserve it exactly, pixel-faithfully: cut, color, seams, every graphic shape, placement and distress. Do not invent or relocate any neck-label pixels.`,
    "IMAGE 2 is SCENE ONLY: reproduce only its surface, perspective, crop and light; ignore its garment, print, label, text and objects.",
    side === "front"
      ? "It must remain a FRONT view with a clean crew-neck shape. The internal heat-transfer marking is hidden inside the back-neck panel. Keep collar ribbing and upper external chest free of every label mark. NO hang tag, paper tag, sewn label, woven tab, white locator, fastener, string, cropped tag fragment, L.G.B. or size text may be visible."
      : "It must remain a BACK view with a higher closed rear neckline. The internal heat-transfer marking is hidden inside. NO hang tag, paper tag, sewn label, woven tab, white locator, fastener, string, cropped tag fragment, L.G.B. or label wording may be visible.",
    "SHOT DIVERSITY LOCK: this image must be visibly different from IMAGE 1 in camera side, oblique perspective, garment rotation and fold silhouette. A near-identical overhead duplicate is forbidden.",
    "Change only natural placement, folds and camera angle. Never redesign, mirror, add, remove, simplify or hide product details.",
    "Real cotton weave, absorbed ink, gravity and contact shadows; no CGI, pasted edges, props, watermarks or extra garments. Return one sharp photorealistic marketplace photo.",
  ].join(" ");
}
