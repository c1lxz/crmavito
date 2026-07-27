import { auth } from "@/lib/auth";
import { authorizeFlowAgent, flowAgentUnauthorized } from "@/lib/ai/flow-agent-auth";
import { readFlowAgentStatus, saveFlowAgentStatus, type FlowAgentState } from "@/lib/ai/flow-agent-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") return Response.json({ error: "Недостаточно прав." }, { status: 403 });
  return Response.json({ status: await readFlowAgentStatus() });
}

export async function POST(request: Request) {
  if (!authorizeFlowAgent(request)) return flowAgentUnauthorized();
  try {
    const body = await request.json() as {
      agentId?: string;
      state?: FlowAgentState;
      message?: string;
      checkedAt?: string;
      concurrency?: number;
    };
    if (!body.agentId?.trim()) throw new Error("Не указан agentId.");
    if (!["ready", "blocked", "auth_required", "error"].includes(body.state || "")) throw new Error("Некорректный статус.");
    const checkedAt = new Date(body.checkedAt || Date.now()).toISOString();
    await saveFlowAgentStatus({
      agentId: body.agentId.trim().slice(0, 100),
      state: body.state!,
      message: String(body.message || "").slice(0, 500),
      checkedAt,
      concurrency: Math.min(6, Math.max(1, Number(body.concurrency) || 1)),
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
