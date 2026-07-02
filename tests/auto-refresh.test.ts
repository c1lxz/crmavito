import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const autoRefreshSource = readFileSync(
  path.resolve(__dirname, "../components/layout/auto-refresh.tsx"),
  "utf8"
);
const appLayoutSource = readFileSync(
  path.resolve(__dirname, "../app/(app)/layout.tsx"),
  "utf8"
);
const reportsSource = readFileSync(
  path.resolve(__dirname, "../components/reports/reports-client.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  path.resolve(__dirname, "../app/(app)/dashboard/page.tsx"),
  "utf8",
);

describe("authenticated page auto-refresh", () => {
  it("mounts once for every authenticated app page", () => {
    expect(appLayoutSource).toContain('import { AutoRefresh }');
    expect(appLayoutSource).toContain("<AutoRefresh />");
  });

  it("refreshes server data every minute and when the tab becomes visible", () => {
    expect(autoRefreshSource).toContain("60_000");
    expect(autoRefreshSource).toContain("window.setInterval");
    expect(autoRefreshSource).toContain('"visibilitychange"');
    expect(autoRefreshSource).toContain("router.refresh()");
  });

  it("does not refresh while the user is editing or a dialog is open", () => {
    expect(autoRefreshSource).toContain("isUserEditing()");
    expect(autoRefreshSource).toContain("input, textarea, select");
    expect(autoRefreshSource).toContain('[role="dialog"][data-state="open"]');
  });

  it("cleans up its timer and event listener", () => {
    expect(autoRefreshSource).toContain("window.clearInterval");
    expect(autoRefreshSource).toContain('removeEventListener("visibilitychange"');
  });

  it("detects Moscow midnight and advances open report date ranges", () => {
    expect(autoRefreshSource).toContain("formatDateInput()");
    expect(autoRefreshSource).toContain("MOSCOW_DAY_CHANGED_EVENT");
    expect(autoRefreshSource).toContain("window.dispatchEvent");
    expect(autoRefreshSource).toContain("!dayChanged && isUserEditing()");
    expect(reportsSource).toContain("handleMoscowDayChanged");
    expect(reportsSource).toContain("setDateTo(detail.currentDay)");
  });

  it("forces fresh server calculations for the main dashboard", () => {
    expect(dashboardSource).toContain('dynamic = "force-dynamic"');
    expect(dashboardSource).toContain("revalidate = 0");
    expect(dashboardSource).toContain("todayDateStart");
    expect(dashboardSource).toContain("startOfDatabaseDate");
  });
});
