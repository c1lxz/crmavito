import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(path.resolve(__dirname, "../app/page.tsx"), "utf8");

describe("root open menu", () => {
  it("serves a chooser for bot buttons instead of redirecting away", () => {
    expect(homeSource).toContain("CRM STROK SHOP");
    expect(homeSource).toContain("Выберите, что открыть");
    expect(homeSource).toContain('href: "/m/dashboard"');
    expect(homeSource).toContain('href: "/pc/dashboard"');
    expect(homeSource).toContain('href: "/v"');
    expect(homeSource).not.toContain("redirect(");
    expect(homeSource).not.toContain("auth()");
  });
});
