import { describe, expect, it } from "vitest";
import {
  buildRecentReportRange,
  getPreviousReportRange,
  parseReportRange,
} from "@/lib/reports/range";
import {
  endOfDay,
  endOfDatabaseDate,
  endOfMonth,
  formatDateInput,
  startOfDatabaseDate,
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

  it.each([
    [30, "2026-06-19"],
    [60, "2026-05-20"],
    [90, "2026-04-20"],
  ])("builds an inclusive %i-day preset", (days, dateFrom) => {
    expect(buildRecentReportRange(days, new Date("2026-07-18T12:00:00Z"))).toEqual({
      dateFrom,
      dateTo: "2026-07-18",
    });
  });

  it("builds an equally sized, non-overlapping previous period", () => {
    const current = parseReportRange("2026-04-20", "2026-07-18");
    const previous = getPreviousReportRange(current);

    expect(previous.from.toISOString()).toBe("2026-01-19T21:00:00.000Z");
    expect(previous.to.toISOString()).toBe("2026-04-19T20:59:59.999Z");
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

  it("uses UTC calendar boundaries for PostgreSQL DATE columns", () => {
    const instant = new Date("2026-07-01T22:30:00.000Z");
    expect(startOfDatabaseDate(instant).toISOString()).toBe("2026-07-02T00:00:00.000Z");
    expect(endOfDatabaseDate(instant).toISOString()).toBe("2026-07-02T23:59:59.999Z");
  });
});
