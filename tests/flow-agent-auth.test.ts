import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorizeFlowAgent } from "@/lib/ai/flow-agent-auth";
import { readFlowAgentStatus, saveFlowAgentStatus } from "@/lib/ai/flow-agent-status";

const originalToken = process.env.FLOW_LOCAL_AGENT_TOKEN;
const originalDataDirectory = process.env.CONTENT_MACHINE_DATA_DIR;

afterEach(() => {
  if (originalToken === undefined) delete process.env.FLOW_LOCAL_AGENT_TOKEN;
  else process.env.FLOW_LOCAL_AGENT_TOKEN = originalToken;
  if (originalDataDirectory === undefined) delete process.env.CONTENT_MACHINE_DATA_DIR;
  else process.env.CONTENT_MACHINE_DATA_DIR = originalDataDirectory;
});

describe("Flow agent authentication", () => {
  it("requires an exact bearer token and fails closed without configuration", () => {
    delete process.env.FLOW_LOCAL_AGENT_TOKEN;
    expect(authorizeFlowAgent(new Request("http://localhost"))).toBe(false);
    process.env.FLOW_LOCAL_AGENT_TOKEN = "secret-token";
    expect(authorizeFlowAgent(new Request("http://localhost", { headers: { authorization: "Bearer wrong" } }))).toBe(false);
    expect(authorizeFlowAgent(new Request("http://localhost", { headers: { authorization: "Bearer secret-token" } }))).toBe(true);
  });

  it("persists a fresh readiness heartbeat for the CRM UI", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flow-agent-status-"));
    process.env.CONTENT_MACHINE_DATA_DIR = directory;
    try {
      await saveFlowAgentStatus({
        agentId: "desktop-agent",
        state: "ready",
        message: "Flow ready",
        checkedAt: new Date().toISOString(),
        concurrency: 3,
      });
      await saveFlowAgentStatus({
        agentId: "blocked-public-agent",
        state: "blocked",
        message: "Wrong region",
        checkedAt: new Date(Date.now() + 1_000).toISOString(),
        concurrency: 1,
      });
      const status = await readFlowAgentStatus();
      expect(status.online).toBe(true);
      expect(status.state).toBe("ready");
      expect(status.concurrency).toBe(3);
      expect(status.agentsOnline).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("installs a non-admin autostart fallback and detects only Node agent processes", () => {
    const root = path.resolve(__dirname, "..");
    const installer = readFileSync(path.join(root, "scripts/install-flow-local-agent-task.ps1"), "utf8");
    const ensure = readFileSync(path.join(root, "scripts/ensure-flow-local-agent.ps1"), "utf8");
    const agent = readFileSync(path.join(root, "scripts/flow-local-agent.ts"), "utf8");
    const client = readFileSync(path.join(root, "components/content-machine/content-machine-client.tsx"), "utf8");
    expect(installer).toContain("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    expect(installer).toContain("RunLevel Limited");
    expect(ensure).toContain('$_.Name -eq "node.exe"');
    expect(ensure).toContain("*scripts/flow-local-agent.ts*");
    expect(ensure).toContain('$env:COMPUTERNAME -eq "DESKTOP-1QUOHBP"');
    expect(ensure).toContain("start_google_flow_proxy.ps1");
    expect(agent).toContain("chromium.connectOverCDP(cdpUrl)");
    expect(agent).toContain("preservePages");
    expect(agent).toContain("CRM poll failed");
    expect(agent).toContain("CRM вернула не-JSON ответ");
    expect(agent).toContain("probeFlow");
    expect(agent).toContain("Агент готов; Flow откроется только при запуске генерации.");
    expect(agent.indexOf("job = await claimJob()"))
      .toBeLessThan(agent.indexOf("await runJobInFlow(job,"));
    expect(agent.indexOf("async function runJobInFlow"))
      .toBeLessThan(agent.lastIndexOf("const session = await launchFlowSession()"));
    expect(agent).toContain("/api/ai/content-machine/flow-agent/status");
    expect(client).toContain("Flow: регион заблокирован");
  });
});
