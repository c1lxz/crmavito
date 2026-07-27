import { timingSafeEqual } from "node:crypto";

export function authorizeFlowAgent(request: Request) {
  const expected = process.env.FLOW_LOCAL_AGENT_TOKEN?.trim();
  if (!expected) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function flowAgentUnauthorized() {
  return Response.json({ error: "Неверный токен локального Flow-агента." }, { status: 401 });
}
