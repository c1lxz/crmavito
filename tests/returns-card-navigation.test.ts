import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("returns card navigation", () => {
  it("opens the order from the return card body without a separate card button", () => {
    const source = readFileSync(path.resolve(__dirname, "../components/returns/returns-client.tsx"), "utf8");

    expect(source).toContain("ChevronRight");
    expect(source).toContain('href={`/orders/${ret.order.id}`}');
    expect(source).toContain('className="block"');
    expect(source).not.toContain(">Карточка<");
  });
});
