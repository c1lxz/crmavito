import { claimNextFlowJob } from "@/lib/ai/content-machine-jobs";
import { authorizeFlowAgent, flowAgentUnauthorized } from "@/lib/ai/flow-agent-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authorizeFlowAgent(request)) return flowAgentUnauthorized();
  const body = await request.json().catch(() => ({})) as { agentId?: string };
  const agentId = body.agentId?.trim().slice(0, 100);
  if (!agentId) return Response.json({ error: "Не указан agentId." }, { status: 400 });
  return Response.json({ job: await claimNextFlowJob(agentId) });
}
