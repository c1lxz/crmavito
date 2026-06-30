import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0 || files.length > 9) {
    return NextResponse.json({ error: "Выберите от 1 до 9 фотографий" }, { status: 400 });
  }

  const uploadDirectory = path.join(process.cwd(), "public", "uploads", "orders");
  await mkdir(uploadDirectory, { recursive: true });

  const urls: string[] = [];
  for (const file of files) {
    const extension = ALLOWED_TYPES[file.type];
    if (!extension || file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Разрешены JPG, PNG, WebP и GIF до 10 МБ" },
        { status: 400 }
      );
    }
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(path.join(uploadDirectory, filename), Buffer.from(await file.arrayBuffer()));
    urls.push(`/uploads/orders/${filename}`);
  }

  return NextResponse.json({ urls });
}
