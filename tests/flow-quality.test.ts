import { describe, expect, it } from "vitest";
import { parseQualityVerdict } from "@/lib/flow-agent/quality";

describe("Flow product photo quality gate", () => {
  it("accepts a high-confidence clean result", () => {
    expect(parseQualityVerdict('{"pass":true,"score":91,"issues":[]}')).toEqual({
      pass: true,
      score: 91,
      issues: [],
    });
  });

  it("rejects a nominal pass below the strict threshold", () => {
    expect(parseQualityVerdict('```json\n{"pass":true,"score":81,"issues":["print uncertain"]}\n```')).toMatchObject({
      pass: false,
      score: 81,
      issues: ["print uncertain"],
    });
  });
});
