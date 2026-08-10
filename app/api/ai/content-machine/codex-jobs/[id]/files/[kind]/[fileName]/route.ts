import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readCodexJobFile } from "@/lib/ai/content-machine-jobs";

export async function GET(_request: Request, context: { params: Promise<{ id: string; kind: string; fileName: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  try {
    const { id, kind, fileName } = await context.params;
    const file = await readCodexJobFile(id, kind, fileName);
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: { "content-type": file.mimeType, "cache-control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
