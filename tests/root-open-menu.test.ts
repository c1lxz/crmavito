import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(path.resolve(__dirname, "../app/page.tsx"), "utf8");
const menuSource = readFileSync(path.resolve(__dirname, "../app/menu/page.tsx"), "utf8");
const openMenuSource = readFileSync(path.resolve(__dirname, "../components/open-menu.tsx"), "utf8");
const middlewareSource = readFileSync(path.resolve(__dirname, "../middleware.ts"), "utf8");

describe("root open menu", () => {
  it("serves a chooser on /menu for bot buttons", () => {
    expect(homeSource).toContain("OpenMenu");
    expect(menuSource).toContain("OpenMenu");
    expect(openMenuSource).toContain("CRM STROK SHOP");
    expect(openMenuSource).toContain("Выберите, что открыть");
    expect(openMenuSource).toContain('href: "/m/dashboard"');
    expect(openMenuSource).toContain('href: "/pc/dashboard"');
    expect(openMenuSource).toContain('href: "/v"');
    expect(homeSource).not.toContain("redirect(");
    expect(homeSource).not.toContain("auth()");
    expect(menuSource).not.toContain("redirect(");
  });

  it("does not redirect normal app routes back to /m or /pc", () => {
    expect(middlewareSource).not.toContain("rememberedMode");
    expect(middlewareSource).not.toContain("`/${rememberedMode}${pathname}`");
  });
});
