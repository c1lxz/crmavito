import { consumeFlowAgentEnrollment } from "@/lib/ai/flow-agent-enrollment";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { code?: string; agentId?: string };
    const token = await consumeFlowAgentEnrollment(String(body.code || ""), String(body.agentId || ""));
    return Response.json({ token }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
