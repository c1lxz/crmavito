import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schemaSource = readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8");
const storeSource = readFileSync(path.resolve(__dirname, "../lib/avito/profile-store.ts"), "utf8");
const settingsClientSource = readFileSync(path.resolve(__dirname, "../components/settings/settings-client.tsx"), "utf8");
const credentialsRouteSource = readFileSync(
  path.resolve(__dirname, "../app/api/avito-profiles/credentials/route.ts"),
  "utf8",
);
const stocksClientSource = readFileSync(
  path.resolve(__dirname, "../components/settings/stocks-client.tsx"),
  "utf8",
);
const stocksRouteSource = readFileSync(path.resolve(__dirname, "../app/api/avito/stocks/route.ts"), "utf8");
const stocksUpdateRouteSource = readFileSync(
  path.resolve(__dirname, "../app/api/avito/stocks/update/route.ts"),
  "utf8",
);

describe("Avito credential profiles", () => {
  it("stores credentials and report email on Avito profiles", () => {
    expect(schemaSource).toContain("accountId");
    expect(schemaSource).toContain("clientId");
    expect(schemaSource).toContain("clientSecret");
    expect(schemaSource).toContain("reportEmail");
    expect(storeSource).toContain("listAvitoProfilesWithCredentials");
    expect(storeSource).toContain("getAvitoCredentials");
    expect(storeSource).toContain("getAvitoProfileReportEmail");
    expect(storeSource).toContain("getAvitoProfileContactPhone");
    expect(storeSource).toContain("getAvitoProfileAutoloadSettings");
    expect(storeSource).toContain("PROFILE_CONTACT_PHONES");
    expect(storeSource).toContain("normalizeAvitoXmlPhone");
    expect(storeSource).toContain("avitoXmlPhoneForProfileName");
    expect(storeSource).toContain("+7 (999) 121-23-49");
    expect(settingsClientSource).not.toContain("Телефон XML");
  });

  it("exposes saved credential profiles without browser-visible secrets", () => {
    expect(credentialsRouteSource).toContain("session.user.role !== \"ADMIN\"");
    expect(credentialsRouteSource).toContain("listAvitoProfilesWithCredentials");
    expect(storeSource).toContain("clientId: _clientId");
    expect(storeSource).toContain("clientSecret: _clientSecret");
  });

  it("uses server profiles and optional manual keys in stock management", () => {
    expect(stocksClientSource).toContain("/api/avito-profiles/credentials");
    expect(stocksClientSource).toContain("credentialProfiles");
    expect(stocksClientSource).toContain("selectedProfileId");
    expect(stocksClientSource).toContain("manualClientId");
    expect(stocksClientSource).toContain("manualClientSecret");
    expect(stocksClientSource).toContain("avitoAuthPayload");
    expect(stocksClientSource).toContain("selectAllItems");
    expect(stocksClientSource).not.toContain("crmavito:avito-stocks-credentials");
    expect(stocksClientSource).not.toContain("localStorage");
  });

  it("supports drag selection in stock management", () => {
    expect(stocksClientSource).toContain("dragSelection");
    expect(stocksClientSource).toContain("startDragSelection");
    expect(stocksClientSource).toContain("applyDragSelection");
    expect(stocksClientSource).toContain("onMouseDown={(event) => startDragSelection");
    expect(stocksClientSource).toContain("onMouseEnter={() => applyDragSelection");
  });

  it("resolves profileId or manual credentials in stock management", () => {
    expect(stocksRouteSource).toContain("getAvitoCredentials");
    expect(stocksRouteSource).toContain("profileId");
    expect(stocksRouteSource).toContain("clientId");
    expect(stocksRouteSource).toContain("clientSecret");
    expect(stocksUpdateRouteSource).toContain("getAvitoCredentials");
    expect(stocksUpdateRouteSource).toContain("profileId");
    expect(stocksUpdateRouteSource).toContain("clientId");
    expect(stocksUpdateRouteSource).toContain("clientSecret");
  });
});
