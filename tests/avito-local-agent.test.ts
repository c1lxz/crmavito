import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageSource = readFileSync(path.resolve(__dirname, "../package.json"), "utf8");
const clientSource = readFileSync(
  path.resolve(__dirname, "../components/settings/market-analysis-client.tsx"),
  "utf8",
);
const agentSource = readFileSync(path.resolve(__dirname, "../scripts/avito-local-agent.ts"), "utf8");

describe("Avito local market agent", () => {
  it("has a one-command local agent entrypoint", () => {
    expect(packageSource).toContain('"avito:local-agent": "tsx scripts/avito-local-agent.ts"');
    expect(packageSource).toContain('"avito:local-browser-agent"');
  });

  it("runs market analysis from the employee device", () => {
    expect(clientSource).toContain("http://127.0.0.1:3217/api/avito/market-analysis/probe");
    expect(clientSource).toContain("normalizeProbeResult");
    expect(clientSource).not.toContain('fetch("/api/avito/market-analysis/probe"');
    expect(agentSource).toContain("analyzeAvitoMarket");
    expect(agentSource).toContain("launchPersistentContext");
    expect(agentSource).toContain("summary:");
    expect(agentSource).toContain("access-control-allow-origin");
  });
});
