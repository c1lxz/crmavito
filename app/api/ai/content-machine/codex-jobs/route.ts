import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createCodexJob } from "@/lib/ai/content-machine-jobs";

export const maxDuration = 120;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  try {
    const form = await request.formData();
    const products = form.getAll("products").filter((value): value is File => value instanceof File);
    const imageSize = form.get("imageSize") === "4K" ? "4K" : "2K";
    const job = await createCodexJob(products, imageSize);
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
