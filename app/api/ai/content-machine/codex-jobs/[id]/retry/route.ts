import { auth } from "@/lib/auth";
import { retryFlowJob } from "@/lib/ai/content-machine-jobs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Не авторизован." }, { status: 401 });
  try {
    const { id } = await params;
    return Response.json({ job: await retryFlowJob(id) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
