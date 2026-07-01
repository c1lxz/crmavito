import { describe, expect, it } from "vitest";
import { parseReportRange } from "@/lib/reports/range";
import {
  endOfDay,
  endOfMonth,
  formatDateInput,
  startOfDay,
  startOfMonth,
} from "@/lib/utils";

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
  it("switches the calendar day exactly at Moscow midnight", () => {
    expect(formatDateInput(new Date("2026-07-01T20:59:59.999Z"))).toBe("2026-07-01");
    expect(formatDateInput(new Date("2026-07-01T21:00:00.000Z"))).toBe("2026-07-02");
  });

  it("builds Moscow day and month boundaries independently of server timezone", () => {
    const instant = new Date("2026-07-01T22:30:00.000Z");
    expect(startOfDay(instant).toISOString()).toBe("2026-07-01T21:00:00.000Z");
    expect(endOfDay(instant).toISOString()).toBe("2026-07-02T20:59:59.999Z");
    expect(startOfMonth(instant).toISOString()).toBe("2026-06-30T21:00:00.000Z");
    expect(endOfMonth(instant).toISOString()).toBe("2026-07-31T20:59:59.999Z");
  });
});
