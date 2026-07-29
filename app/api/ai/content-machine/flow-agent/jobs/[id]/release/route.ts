import { releaseFlowJob } from "@/lib/ai/content-machine-jobs";
import { authorizeFlowAgent, flowAgentUnauthorized } from "@/lib/ai/flow-agent-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorizeFlowAgent(request)) return flowAgentUnauthorized();
  try {
    const { id } = await params;
    const body = await request.json() as { agentId: string; error: string };
    return Response.json({ job: await releaseFlowJob(id, body.agentId, body.error) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
