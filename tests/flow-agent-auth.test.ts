import { afterEach, describe, expect, it } from "vitest";
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
});
