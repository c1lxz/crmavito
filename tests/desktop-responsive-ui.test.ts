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
const marketAnalysisSource = readFileSync(
  path.resolve(__dirname, "../components/settings/market-analysis-client.tsx"),
  "utf8",
);

describe("desktop responsive UI", () => {
  it("splits explicit /pc and /m modes instead of relying on viewport width", () => {
    expect(middlewareSource).toContain('pathname.match(/^\\/(pc|m)');
    expect(middlewareSource).toContain('process.env.NEXTAUTH_URL || "https://crmavito.duckdns.org"');
    expect(middlewareSource).toContain("NextResponse.rewrite(target");
    expect(middlewareSource).not.toContain("NextResponse.redirect(target)");
    expect(middlewareSource).not.toContain('req.headers.get("x-forwarded-proto")');
    expect(middlewareSource).not.toContain('req.headers.get("x-forwarded-host")');
    expect(middlewareSource).not.toContain(".replace(/:\\d+$/,");
    expect(middlewareSource).not.toContain('rewriteUrl.hostname = "localhost"');
    expect(middlewareSource).not.toContain('rewriteUrl.port = "3000"');
    expect(middlewareSource).toContain("crmavito-ui-mode");
    expect(middlewareSource).toContain('target.searchParams.set("ui", mode)');
    expect(middlewareSource).toContain('pathname === "/dashboard" ? "pc" : null');
    expect(middlewareSource).toContain('requestHeaders.set("x-crmavito-ui-mode", forcedMode)');
    expect(appLayoutSource).toContain('cookieStore.get("crmavito-ui-mode")?.value');
    expect(appLayoutSource).toContain('requestHeaders.get("x-crmavito-ui-mode")');
    expect(appLayoutSource).toContain('forcedMode === "m" || forcedMode === "pc"');
    expect(appLayoutSource).not.toContain("mobileDevice");
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
    expect(globalsSource).toContain(".mobile-shell main");
    expect(globalsSource).toContain("overflow-x: hidden");
    expect(globalsSource).toContain(".dashboard-finance-grid");
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
    expect(ordersSource).toContain("filtersHidden");
    expect(ordersSource).toContain("orders-filter-panel");
    expect(ordersSource).toContain('window.addEventListener("scroll"');
    expect(ordersSource).toContain("<table className=\"w-full table-fixed text-sm\">");
    expect(ordersSource).toContain("router.push(");
    expect(returnsSource).toContain("pc-only hidden overflow-hidden rounded-lg border border-border bg-card");
    expect(returnsSource).toContain("mobile-only space-y-3");
    expect(returnsSource).toContain("<table className=\"w-full table-fixed text-sm\">");
    expect(productsSource).toContain("pc-products-grid");
    expect(reportsSource).toContain("pc-reports-kpi");
    expect(reportsSource).toContain("pc-donut-grid");
    expect(marketAnalysisSource).toContain("market-analysis-controls");
    expect(marketAnalysisSource).toContain('className="w-full min-w-0 space-y-1 sm:w-auto"');
    expect(marketAnalysisSource).toContain('inputMode="numeric"');
    expect(globalsSource).toContain("grid-template-columns: 9rem minmax(18rem, 1fr) auto auto");
    expect(marketAnalysisSource).toContain("analytics-overview");
    expect(marketAnalysisSource).toContain("analytics-ranking-table");
    expect(marketAnalysisSource).toContain("pc-only hidden overflow-x-auto");
    expect(marketAnalysisSource).toContain("mobile-only space-y-1");
    expect(globalsSource).toContain(".pc-shell .analytics-ranking-table");
    expect(globalsSource).not.toContain("pc-analytics-workspace");
  });
});
