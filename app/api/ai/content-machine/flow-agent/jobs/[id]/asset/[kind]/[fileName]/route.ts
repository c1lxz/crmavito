import { readCodexJobFile } from "@/lib/ai/content-machine-jobs";
import { authorizeFlowAgent, flowAgentUnauthorized } from "@/lib/ai/flow-agent-auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; kind: string; fileName: string }> }) {
  if (!authorizeFlowAgent(request)) return flowAgentUnauthorized();
  try {
    const { id, kind, fileName } = await params;
    const file = await readCodexJobFile(id, kind, fileName);
    return new Response(file.buffer, { headers: { "content-type": file.mimeType, "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
