import { parseBackgroundSlot } from "@/lib/ai/content-machine";
import { saveFlowJobResult } from "@/lib/ai/content-machine-jobs";
import { authorizeFlowAgent, flowAgentUnauthorized } from "@/lib/ai/flow-agent-auth";

export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorizeFlowAgent(request)) return flowAgentUnauthorized();
  try {
    const { id } = await params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Результат не приложен.");
    const backgroundSlot = parseBackgroundSlot(form.get("backgroundSlot"));
    if (!backgroundSlot) throw new Error("Некорректный фон.");
    const job = await saveFlowJobResult(id, {
      agentId: String(form.get("agentId") || ""),
      productIndex: Number(form.get("productIndex")),
      backgroundSlot,
      file,
      metric: {
        startedAt: String(form.get("startedAt")),
        durationMs: Number(form.get("durationMs")),
        uploadMs: Number(form.get("uploadMs")),
        generationMs: Number(form.get("generationMs")),
      },
    });
    return Response.json({ job });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
