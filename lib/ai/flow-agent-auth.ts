import { timingSafeEqual } from "node:crypto";
import { authorizeEnrolledFlowAgent } from "@/lib/ai/flow-agent-enrollment";

export function authorizeFlowAgent(request: Request) {
  const expected = process.env.FLOW_LOCAL_AGENT_TOKEN?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (expected) {
    const left = Buffer.from(expected);
    const right = Buffer.from(supplied);
    if (left.length === right.length && timingSafeEqual(left, right)) return true;
  }
  return authorizeEnrolledFlowAgent(supplied, request.headers.get("x-flow-agent-id") || "");
}

export function flowAgentUnauthorized() {
  return Response.json({ error: "Неверный токен локального Flow-агента." }, { status: 401 });
}
