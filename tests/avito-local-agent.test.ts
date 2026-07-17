import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageSource = readFileSync(path.resolve(__dirname, "../package.json"), "utf8");
const clientSource = readFileSync(
  path.resolve(__dirname, "../components/settings/market-analysis-client.tsx"),
  "utf8",
);
const agentSource = readFileSync(path.resolve(__dirname, "../scripts/avito-local-agent.ts"), "utf8");
const ensureSource = readFileSync(path.resolve(__dirname, "../scripts/ensure-avito-local-agent.ps1"), "utf8");
const installSource = readFileSync(path.resolve(__dirname, "../scripts/install-avito-local-agent-task.ps1"), "utf8");

describe("Avito local market agent", () => {
  it("has a one-command local agent entrypoint", () => {
    expect(packageSource).toContain('"avito:local-agent": "tsx scripts/avito-local-agent.ts"');
    expect(packageSource).toContain('"avito:local-browser-agent"');
    expect(packageSource).toContain('"avito:install-local-agent"');
  });

  it("runs market analysis from the employee device", () => {
    expect(clientSource).toContain("http://127.0.0.1:3217/api/avito/market-analysis/probe");
    expect(clientSource).toContain("http://127.0.0.1:3217/health");
    expect(clientSource).toContain("waitForLocalAgent");
    expect(clientSource).toContain("normalizeProbeResult");
    expect(clientSource).not.toContain('fetch("/api/avito/market-analysis/probe"');
    expect(agentSource).toContain("analyzeAvitoMarket");
    expect(agentSource).toContain("launchPersistentContext");
    expect(agentSource).toContain("summary:");
    expect(agentSource).toContain("access-control-allow-origin");
  });

  it("pauses browser collection for manual Avito access checks", () => {
    expect(agentSource).toContain("AVITO_LOCAL_AGENT_ACCESS_TIMEOUT_MS");
    expect(agentSource).toContain("isAvitoAccessCheckVisible");
    expect(agentSource).toContain("bringToFront");
    expect(agentSource).toContain("complete the captcha manually");
    expect(agentSource).toContain("AVITO_LOCAL_AGENT_CAPTCHA_TELEGRAM_CHAT_ID");
    expect(agentSource).toContain("@itneurobusiness");
    expect(agentSource).toContain("sendPhoto");
    expect(agentSource).toContain("saveBrowserRunState");
    expect(agentSource).toContain("Browser agent resumed previous progress");
  });

  it("can install a Windows autostart task for the local browser agent", () => {
    expect(ensureSource).toContain("avito:local-browser-agent");
    expect(ensureSource).toContain("Get-NetTCPConnection");
    expect(ensureSource).toContain("Start-Process");
    expect(installSource).toContain("Register-ScheduledTask");
    expect(installSource).toContain("CurrentVersion\\Run");
    expect(installSource).toContain("CRM Avito Local Agent");
  });

  it("skips wholesale and used Avito listings in browser mode", () => {
    expect(agentSource).toContain("SKIP_USED_OR_WHOLESALE_NOTE");
    expect(agentSource).toContain("extractBrowserListingPreviews");
    expect(agentSource).toContain("isUsedOrWholesaleText");
    expect(agentSource).toContain("Browser agent skips wholesale and used listings");
    expect(agentSource).toContain("Skipped wholesale/used");
  });
});
