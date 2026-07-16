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

describe("desktop responsive UI", () => {
  it("keeps mobile width on phones and opens a wide desktop workspace", () => {
    expect(appLayoutSource).toContain("lg:ml-64");
    expect(appLayoutSource).toContain("lg:max-w-none");
    expect(appLayoutSource).toContain("<DesktopSidebar />");
    expect(bottomNavSource).toContain("lg:hidden");
    expect(globalsSource).toContain("@media (min-width: 1024px)");
    expect(globalsSource).toContain(".app-header");
    expect(globalsSource).toContain("@apply px-8 py-5");
  });

  it("adds a desktop sidebar with the main working sections", () => {
    expect(desktopSidebarSource).toContain("hidden w-64");
    expect(desktopSidebarSource).toContain("/orders");
    expect(desktopSidebarSource).toContain("/returns");
    expect(desktopSidebarSource).toContain("/products");
    expect(desktopSidebarSource).toContain("/reports");
    expect(desktopSidebarSource).toContain("usePathname");
  });

  it("uses dense desktop layouts for the main operational screens", () => {
    expect(ordersSource).toContain("hidden overflow-hidden rounded-lg border border-border bg-card lg:block");
    expect(ordersSource).toContain("<table className=\"w-full table-fixed text-sm\">");
    expect(ordersSource).toContain("router.push(");
    expect(returnsSource).toContain("hidden overflow-hidden rounded-lg border border-border bg-card lg:block");
    expect(returnsSource).toContain("<table className=\"w-full table-fixed text-sm\">");
    expect(productsSource).toContain("lg:grid-cols-2 2xl:grid-cols-3");
    expect(reportsSource).toContain("lg:grid-cols-3 2xl:grid-cols-6");
    expect(reportsSource).toContain("lg:grid-cols-3");
  });
});
