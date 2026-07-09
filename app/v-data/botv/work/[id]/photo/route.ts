import { GET as apiGET } from "@/app/api/botv/session/[id]/photo/route";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext) {
  return apiGET(request, context);
}
