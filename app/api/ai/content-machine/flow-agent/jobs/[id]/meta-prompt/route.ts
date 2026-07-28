import { createClaudeDesignMetaPrompt } from "@/lib/ai/claude-content-design";
import { getFlowDesignPromptContext, saveFlowDesignPrompt } from "@/lib/ai/content-machine-jobs";
import { authorizeFlowAgent, flowAgentUnauthorized } from "@/lib/ai/flow-agent-auth";
import { buildOriginalDesignPrompt } from "@/lib/flow-agent/market-research";

export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!authorizeFlowAgent(request)) return flowAgentUnauthorized();
  try {
    const { id } = await context.params;
    const body = await request.json() as { agentId?: string };
    if (!body.agentId) return Response.json({ error: "Не указан локальный агент." }, { status: 400 });
    const promptContext = await getFlowDesignPromptContext(id, body.agentId);
    if (promptContext.designPrompt) return Response.json({ prompt: promptContext.designPrompt, source: "cache" });
    try {
      const generated = await createClaudeDesignMetaPrompt(promptContext);
      await saveFlowDesignPrompt(id, body.agentId, generated.prompt, "claude");
      return Response.json({ prompt: generated.prompt, source: "claude", model: generated.model });
    } catch (error) {
      const prompt = buildOriginalDesignPrompt(promptContext.research, promptContext.designNote);
      await saveFlowDesignPrompt(id, body.agentId, prompt, "fallback");
      return Response.json({
        prompt,
        source: "fallback",
        warning: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
