import { locateInsideNeckLabelTarget } from "@/lib/flow-agent/label-target";
import { authorizeFlowAgent, flowAgentUnauthorized } from "@/lib/ai/flow-agent-auth";

export const maxDuration = 90;

export async function POST(request: Request) {
  if (!authorizeFlowAgent(request)) return flowAgentUnauthorized();
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/")) throw new Error("Candidate photo is missing.");
    if (file.size > 15 * 1024 * 1024) throw new Error("Candidate photo is too large.");
    return Response.json({ target: await locateInsideNeckLabelTarget(Buffer.from(await file.arrayBuffer())) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
