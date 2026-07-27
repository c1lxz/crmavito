import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { authorizeFlowAgent } from "@/lib/ai/flow-agent-auth";

const originalToken = process.env.FLOW_LOCAL_AGENT_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.FLOW_LOCAL_AGENT_TOKEN;
  else process.env.FLOW_LOCAL_AGENT_TOKEN = originalToken;
});

describe("Flow agent authentication", () => {
  it("requires an exact bearer token and fails closed without configuration", () => {
    delete process.env.FLOW_LOCAL_AGENT_TOKEN;
    expect(authorizeFlowAgent(new Request("http://localhost"))).toBe(false);
    process.env.FLOW_LOCAL_AGENT_TOKEN = "secret-token";
    expect(authorizeFlowAgent(new Request("http://localhost", { headers: { authorization: "Bearer wrong" } }))).toBe(false);
    expect(authorizeFlowAgent(new Request("http://localhost", { headers: { authorization: "Bearer secret-token" } }))).toBe(true);
  });

  it("installs a non-admin autostart fallback and detects only Node agent processes", () => {
    const root = path.resolve(__dirname, "..");
    const installer = readFileSync(path.join(root, "scripts/install-flow-local-agent-task.ps1"), "utf8");
    const ensure = readFileSync(path.join(root, "scripts/ensure-flow-local-agent.ps1"), "utf8");
    const agent = readFileSync(path.join(root, "scripts/flow-local-agent.ts"), "utf8");
    expect(installer).toContain("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    expect(installer).toContain("RunLevel Limited");
    expect(ensure).toContain('$_.Name -eq "node.exe"');
    expect(ensure).toContain("*scripts/flow-local-agent.ts*");
    expect(agent).toContain("CRM poll failed");
    expect(agent).toContain("CRM вернула не-JSON ответ");
  });
});
