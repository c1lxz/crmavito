import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("bwip-js/node", () => ({
  default: { toBuffer: mocks.toBuffer },
}));

import { GET } from "@/app/api/barcode/route";

describe("barcode API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toBuffer.mockResolvedValue(Buffer.from("png"));
  });

  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/barcode?text=123"));
    expect(response.status).toBe(401);
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });

  it("rejects oversized input before rendering", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    const response = await GET(
      new NextRequest(`http://localhost/api/barcode?text=${"1".repeat(201)}`),
    );
    expect(response.status).toBe(400);
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });

  it("renders a private-cache PNG for an authenticated user", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    const response = await GET(new NextRequest("http://localhost/api/barcode?text=123"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(mocks.toBuffer).toHaveBeenCalledOnce();
  });
});
