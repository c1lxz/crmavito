import { GET as apiGET, POST as apiPOST } from "@/app/api/botv/session/route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  return apiGET(request);
}

export async function POST(request: Request) {
  return apiPOST(request);
}
