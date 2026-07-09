import { POST as apiPOST } from "@/app/api/botv/session/[id]/xml/route";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, context: RouteContext) {
  return apiPOST(request, context);
}
