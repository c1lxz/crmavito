import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../middleware";

describe("mode routing middleware", () => {
  it("keeps /pc in the visible URL and rewrites to the app route", () => {
    const response = middleware(
      new NextRequest("https://crmavito.duckdns.org/pc/orders?status=new"),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://crmavito.duckdns.org/orders?status=new&ui=pc",
    );
    expect(response.cookies.get("crmavito-ui-mode")?.value).toBe("pc");
  });

  it("keeps /m in the visible URL and rewrites to the mobile app route", () => {
    const response = middleware(
      new NextRequest("https://crmavito.duckdns.org/m/dashboard"),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://crmavito.duckdns.org/dashboard?ui=m",
    );
    expect(response.cookies.get("crmavito-ui-mode")?.value).toBe("m");
  });

  it("does not redirect or rewrite /menu", () => {
    const response = middleware(
      new NextRequest("https://crmavito.duckdns.org/menu"),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
