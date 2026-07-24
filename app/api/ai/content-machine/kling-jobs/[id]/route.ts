import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getKlingContentMachineJob } from "@/lib/ai/kling-content-machine-jobs";

export const maxDuration = 120;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  try {
    const { id } = await context.params;
    return NextResponse.json({ job: await getKlingContentMachineJob(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
