import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("long analytics periods UI", () => {
  it("offers 30, 60 and 90 day report presets", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../components/reports/reports-client.tsx"),
      "utf8",
    );

    expect(source).toContain("REPORT_PERIODS = [30, 60, 90]");
    expect(source).toContain("buildRecentReportRange(periodDays)");
    expect(source).toContain('aria-label="Быстрый выбор периода"');
  });

  it("offers the same presets for Avito ads analytics", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../components/settings/market-analysis-client.tsx"),
      "utf8",
    );

    expect(source).toContain("OWN_ANALYTICS_PERIODS = [30, 60, 90]");
    expect(source).toContain("useState(30)");
    expect(source).toContain('aria-label="Быстрый выбор периода аналитики"');
  });
});
