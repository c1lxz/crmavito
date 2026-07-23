import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/settings/ai-analysis-report.tsx", "utf8");

describe("AI analysis report error handling", () => {
  it("does not expose an HTML proxy response as a JSON parsing error", () => {
    expect(source).toContain("function parseReportResponse");
    expect(source).toContain("[502, 503, 504].includes(response.status)");
    expect(source).toContain("Customix не успел завершить отчёт");
    expect(source).not.toContain("const data = raw ? JSON.parse(raw) : {}");
  });
});
