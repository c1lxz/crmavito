import { describe, expect, it } from "vitest";
import { parseReportRange } from "@/lib/reports/range";
import { formatDateInput } from "@/lib/utils";

describe("report date range", () => {
  it("includes the full final day in Moscow time", () => {
    const range = parseReportRange("2026-06-01", "2026-06-30");
    expect(range.from.toISOString()).toBe("2026-05-31T21:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-06-30T20:59:59.999Z");
  });

  it("rejects reversed and invalid dates", () => {
    expect(() => parseReportRange("2026-07-01", "2026-06-30")).toThrow();
    expect(() => parseReportRange("2026-02-30", "2026-03-01")).toThrow();
  });
});

describe("date input formatting", () => {
  it("uses local calendar fields instead of UTC conversion", () => {
    expect(formatDateInput(new Date(2026, 5, 30, 0, 5))).toBe("2026-06-30");
  });
});
