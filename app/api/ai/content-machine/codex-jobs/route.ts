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
    const mode = form.get("mode") === "original-design" ? "original-design" : "product-photo";
    const inspirationQuery = typeof form.get("inspirationQuery") === "string" ? String(form.get("inspirationQuery")) : undefined;
    const designNote = typeof form.get("designNote") === "string" ? String(form.get("designNote")) : undefined;
    const labelStyleReference = typeof form.get("labelStyleReference") === "string" ? String(form.get("labelStyleReference")) : undefined;
    const job = await createCodexJob(products, imageSize, { mode, inspirationQuery, designNote, labelStyleReference });
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
