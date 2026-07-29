import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("CRM theme system", () => {
  it("keeps light, dark, and system themes available", () => {
    const provider = read("components/theme-provider.tsx");
    const toggle = read("components/ui/theme-toggle.tsx");

    expect(provider).toContain('defaultTheme="system"');
    expect(provider).toContain("enableSystem");
    expect(provider).not.toContain("forcedTheme");
    expect(toggle).toContain('{ value: "light"');
    expect(toggle).toContain('{ value: "system"');
    expect(toggle).toContain('{ value: "dark"');
    expect(toggle).toContain("resolvedTheme");
  });

  it("exposes the theme switcher on desktop and mobile dashboard", () => {
    expect(read("components/layout/desktop-sidebar.tsx")).toContain("<ThemeToggle");
    expect(read("app/(app)/dashboard/page.tsx")).toContain("<ThemeToggle");
    expect(read("components/open-menu.tsx")).toContain("<ThemeToggle");
    expect(read("app/(auth)/login/page.tsx")).toContain("<ThemeToggle");
  });

  it("syncs Telegram chrome with the resolved theme", () => {
    const telegram = read("components/telegram/telegram-init.tsx");

    expect(telegram).toContain("resolvedTheme");
    expect(telegram).toContain("setHeaderColor");
    expect(telegram).toContain("setBackgroundColor");
    expect(telegram).toContain('setProperty("--app-top-pad", "32px")');
  });

  it("uses matte text tones instead of absolute white and black", () => {
    const globals = read("app/globals.css");

    expect(globals).toContain("--foreground: 212 29% 28%");
    expect(globals).toContain("--foreground: 207 23% 77%");
    expect(globals).toContain("--muted-foreground: 210 18% 45%");
    expect(globals).toContain("--muted-foreground: 209 18% 57%");
    expect(globals).not.toContain("--primary-foreground: 0 0% 100%");
    expect(globals).not.toContain("--destructive-foreground: 0 0% 100%");
  });
});
