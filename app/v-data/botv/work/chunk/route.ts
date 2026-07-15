import { POST as apiPOST } from "@/app/api/botv/session/chunk/route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return apiPOST(request);
}
