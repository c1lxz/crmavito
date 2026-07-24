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
  });
});
