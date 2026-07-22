import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const clientSource = fs.readFileSync(path.join(root, "components/content-machine/content-machine-client.tsx"), "utf8");
const generateRouteSource = fs.readFileSync(path.join(root, "app/api/ai/content-machine/generate-image/route.ts"), "utf8");
const backgroundsRouteSource = fs.readFileSync(path.join(root, "app/api/ai/content-machine/backgrounds/route.ts"), "utf8");
const storageSource = fs.readFileSync(path.join(root, "lib/ai/content-machine.ts"), "utf8");

describe("content machine", () => {
  it("creates one isolated generation job for every product and background pair", () => {
    expect(clientSource).toContain("products.flatMap((product) => slots.map((slot) => createResult(product, slot)))");
    expect(clientSource).toContain("Promise.all([worker(), worker()])");
    expect(clientSource).toContain("Скачать выбранные");
    expect(clientSource).toContain("onRegenerate");
  });

  it("keeps exactly three persistent reference background slots", () => {
    expect(storageSource).toContain('BACKGROUND_SLOTS = ["1", "2", "3"]');
    expect(storageSource).toContain("CONTENT_MACHINE_DATA_DIR");
    expect(backgroundsRouteSource).toContain("saveBackground(slot, file)");
  });

  it("sends the product and stored background as separate Gemini references", () => {
    expect(generateRouteSource).toContain("referenceImages: GeminiReferenceImage[]");
    expect(generateRouteSource).toContain("productBuffer.toString(\"base64\")");
    expect(generateRouteSource).toContain("background.buffer.toString(\"base64\")");
    expect(generateRouteSource).toContain("buildProductPhotoPrompt()");
  });
});
