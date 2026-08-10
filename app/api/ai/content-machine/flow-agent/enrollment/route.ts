import { auth } from "@/lib/auth";
import { createFlowAgentEnrollment } from "@/lib/ai/flow-agent-enrollment";

export async function POST() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Не авторизован." }, { status: 401 });
  const enrollment = await createFlowAgentEnrollment(String(session.user.id || session.user.email || "employee"));
  return Response.json(enrollment, { headers: { "cache-control": "no-store" } });
}
