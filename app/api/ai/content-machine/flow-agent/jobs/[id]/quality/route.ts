import { authorizeFlowAgent, flowAgentUnauthorized } from "@/lib/ai/flow-agent-auth";
import { evaluateFlowProductPhotoWithClaude } from "@/lib/flow-agent/claude-quality";

export const maxDuration = 120;

export async function POST(request: Request) {
  if (!authorizeFlowAgent(request)) return flowAgentUnauthorized();
  try {
    const form = await request.formData();
    const product = form.get("product");
    const background = form.get("background");
    const candidate = form.get("candidate");
    if (!(product instanceof File) || !(background instanceof File) || !(candidate instanceof File)) {
      return Response.json({ error: "Для Claude QA нужны product, background и candidate." }, { status: 400 });
    }
    const verdict = await evaluateFlowProductPhotoWithClaude({
      product: Buffer.from(await product.arrayBuffer()),
      background: Buffer.from(await background.arrayBuffer()),
      candidate: Buffer.from(await candidate.arrayBuffer()),
    });
    return Response.json(verdict);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
