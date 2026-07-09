import { GET as apiGET, PATCH as apiPATCH } from "@/app/api/botv/session/[id]/route";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, context: RouteContext) {
  return apiGET(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return apiPATCH(request, context);
}
