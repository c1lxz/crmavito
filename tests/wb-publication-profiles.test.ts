import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const client = readFileSync(path.join(root, "components/wbr/wb-resale-client.tsx"), "utf8");
const packageScript = readFileSync(path.join(root, "scripts/build-wb-resale-agent-package.ps1"), "utf8");

describe("WB publication account flow", () => {
  it("chooses a browser profile before every publication start", () => {
    expect(client).toContain("/api/rpa/profiles");
    expect(client).toContain("profileId: selectedProfileId");
    expect(client).toContain("Выберите аккаунт {browserLabel(browser)}");
    expect(client).toContain("Создать XML и открыть WB");
    expect(client).toContain("publish: false");
    expect(client).toContain("Постоянная сессия Wildberries");
    expect(client).toContain("профили установленного Chrome");
    expect(client).toContain('profile.source === "system"');
    expect(client).toContain("/api/rpa/profiles/open");
    expect(client).toContain("Открыть WB");
  });

  it("exposes WB XML export and keeps browser sessions out of the installer", () => {
    expect(client).toContain("/api/export.xml");
    expect(client).toContain("Скачать XML для WB");
    expect(packageScript).toContain(".browser-profile*");
  });
});
