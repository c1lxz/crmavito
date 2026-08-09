import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { locateInsideNeckLabelTarget } from "@/lib/flow-agent/label-target";

async function sampleImage() {
  return sharp({ create: { width: 500, height: 700, channels: 3, background: "#222" } }).jpeg().toBuffer();
}

function geminiResponse(value: Record<string, unknown>) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("inside neck-label target locator", () => {
  it("returns a safe normalized target and sends the no-exterior constraint", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text?: string }> }> };
      expect(body.contents[0].parts[0].text).toContain("INSIDE rear neck panel");
      expect(body.contents[0].parts[0].text).toContain("Never target the outer collar rib");
      return geminiResponse({ visiblePanel: true, confidence: 0.93, centerX: 0.52, centerY: 0.21, widthRatio: 0.065, rotationDeg: -3 });
    });
    await expect(locateInsideNeckLabelTarget(await sampleImage(), { fetchFn: fetchFn as typeof fetch, apiKey: "test" }))
      .resolves.toEqual({ confidence: 0.93, centerX: 0.52, centerY: 0.21, widthRatio: 0.065, rotationDeg: -3 });
  });

  it("rejects a photo where the inside panel is not clearly visible", async () => {
    const fetchFn = vi.fn(async () => geminiResponse({ visiblePanel: false, confidence: 0.99, centerX: 0.5, centerY: 0.2, widthRatio: 0.06, rotationDeg: 0 }));
    await expect(locateInsideNeckLabelTarget(await sampleImage(), { fetchFn: fetchFn as typeof fetch, apiKey: "test" }))
      .rejects.toThrow("does not clearly expose");
  });

  it("rejects unsafe coordinates instead of stamping the outer collar", async () => {
    const fetchFn = vi.fn(async () => geminiResponse({ visiblePanel: true, confidence: 0.95, centerX: 0.5, centerY: 0.04, widthRatio: 0.2, rotationDeg: 0 }));
    await expect(locateInsideNeckLabelTarget(await sampleImage(), { fetchFn: fetchFn as typeof fetch, apiKey: "test" }))
      .rejects.toThrow("unsafe label coordinates");
  });
});
