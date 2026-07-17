import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schemaSource = readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8");
const storeSource = readFileSync(path.resolve(__dirname, "../lib/avito/profile-store.ts"), "utf8");
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
  });

  it("exposes saved credential profiles without browser-visible secrets", () => {
    expect(credentialsRouteSource).toContain("session.user.role !== \"ADMIN\"");
    expect(credentialsRouteSource).toContain("listAvitoProfilesWithCredentials");
    expect(storeSource).toContain("clientId: _clientId");
    expect(storeSource).toContain("clientSecret: _clientSecret");
  });

  it("uses server profiles in stock management instead of manual keys", () => {
    expect(stocksClientSource).toContain("/api/avito-profiles/credentials");
    expect(stocksClientSource).toContain("credentialProfiles");
    expect(stocksClientSource).toContain("selectedProfileId");
    expect(stocksClientSource).toContain("profileId: selectedProfileId");
    expect(stocksClientSource).toContain("selectAllItems");
    expect(stocksClientSource).not.toContain("setClientSecret");
    expect(stocksClientSource).not.toContain("crmavito:avito-stocks-credentials");
    expect(stocksClientSource).not.toContain("localStorage");
  });

  it("resolves profileId without accepting manual credentials in stock management", () => {
    expect(stocksRouteSource).toContain("getAvitoCredentials");
    expect(stocksRouteSource).toContain("profileId");
    expect(stocksUpdateRouteSource).toContain("getAvitoCredentials");
    expect(stocksUpdateRouteSource).toContain("profileId");
    expect(stocksRouteSource).not.toContain("clientSecret: z.string()");
    expect(stocksUpdateRouteSource).not.toContain("clientSecret: z.string()");
  });
});
