import { serveBotvPhoto } from "@/lib/botv/photo-response";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  return serveBotvPhoto(request, id, token);
}
