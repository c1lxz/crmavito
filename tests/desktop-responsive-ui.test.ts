import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appLayoutSource = readFileSync(
  path.resolve(__dirname, "../app/(app)/layout.tsx"),
  "utf8",
);
const globalsSource = readFileSync(
  path.resolve(__dirname, "../app/globals.css"),
  "utf8",
);
const bottomNavSource = readFileSync(
  path.resolve(__dirname, "../components/layout/bottom-nav.tsx"),
  "utf8",
);
const desktopSidebarSource = readFileSync(
  path.resolve(__dirname, "../components/layout/desktop-sidebar.tsx"),
  "utf8",
);
const ordersSource = readFileSync(
  path.resolve(__dirname, "../components/orders/orders-client.tsx"),
  "utf8",
);
const returnsSource = readFileSync(
  path.resolve(__dirname, "../components/returns/returns-client.tsx"),
  "utf8",
);
const productsSource = readFileSync(
  path.resolve(__dirname, "../components/products/products-client.tsx"),
  "utf8",
);
const reportsSource = readFileSync(
  path.resolve(__dirname, "../components/reports/reports-client.tsx"),
  "utf8",
);
const middlewareSource = readFileSync(
  path.resolve(__dirname, "../middleware.ts"),
  "utf8",
);

describe("desktop responsive UI", () => {
  it("splits explicit /pc and /m modes instead of relying on viewport width", () => {
    expect(middlewareSource).toContain('pathname.match(/^\\/(pc|m)');
    expect(middlewareSource).toContain('requestHeaders.set("x-ui-mode", mode)');
    expect(middlewareSource).toContain('req.headers.get("x-forwarded-proto")');
    expect(middlewareSource).toContain('req.headers.get("x-forwarded-host")');
    expect(middlewareSource).not.toContain('rewriteUrl.hostname = "localhost"');
    expect(middlewareSource).not.toContain('rewriteUrl.port = "3000"');
    expect(middlewareSource).toContain("crmavito-ui-mode");
    expect(appLayoutSource).toContain('headerList.get("x-ui-mode") === "pc"');
    expect(appLayoutSource).toContain("pc-shell");
    expect(appLayoutSource).toContain("mobile-shell");
    expect(appLayoutSource).toContain("ml-64");
    expect(appLayoutSource).toContain("max-w-xl");
    expect(appLayoutSource).toContain("isPc ? <DesktopSidebar /> : null");
    expect(appLayoutSource).toContain("isPc ? null : <BottomNav />");
  });

  it("keeps desktop styling scoped to pc-shell so mobile Telegram stays safe", () => {
    expect(globalsSource).toContain(".pc-shell");
    expect(globalsSource).toContain("--app-top-pad: 0px");
    expect(globalsSource).toContain("@apply px-8 py-5");
    expect(globalsSource).toContain(".mobile-shell .pc-only");
    expect(globalsSource).not.toContain("@media (min-width: 1024px)");
  });

  it("adds a desktop sidebar with the main working sections", () => {
    expect(desktopSidebarSource).toContain("hidden w-64");
    expect(desktopSidebarSource).toContain("/pc/orders");
    expect(desktopSidebarSource).toContain("/pc/returns");
    expect(desktopSidebarSource).toContain("/pc/products");
    expect(desktopSidebarSource).toContain("/pc/reports");
    expect(desktopSidebarSource).toContain("usePathname");
    expect(bottomNavSource).toContain("/m/orders");
    expect(bottomNavSource).toContain("/m/dashboard");
  });

  it("uses dense desktop layouts for the main operational screens", () => {
    expect(ordersSource).toContain("pc-only hidden overflow-hidden rounded-lg border border-border bg-card");
    expect(ordersSource).toContain("mobile-only space-y-3");
    expect(ordersSource).toContain("<table className=\"w-full table-fixed text-sm\">");
    expect(ordersSource).toContain("router.push(");
    expect(returnsSource).toContain("pc-only hidden overflow-hidden rounded-lg border border-border bg-card");
    expect(returnsSource).toContain("mobile-only space-y-3");
    expect(returnsSource).toContain("<table className=\"w-full table-fixed text-sm\">");
    expect(productsSource).toContain("pc-products-grid");
    expect(reportsSource).toContain("pc-reports-kpi");
    expect(reportsSource).toContain("pc-donut-grid");
  });
});
