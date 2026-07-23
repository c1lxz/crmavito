import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { noteInclude, serializeNote } from "@/lib/notes/serialize";
import { parseNoteFormData } from "@/lib/notes/validation";
import { removeNoteFiles, saveNoteFiles } from "@/lib/notes/storage";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notes = await prisma.note.findMany({
    where: {
      OR: [
        { visibility: "ALL" },
        { createdByUserId: session.user.id },
        { viewers: { some: { userId: session.user.id } } },
      ],
    },
    include: noteInclude,
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ notes: notes.map(serializeNote) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await request.formData();
    const payload = parseNoteFormData(formData);
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const requestedViewerUserIds = [...new Set(payload.viewerUserIds)].filter((id) => id !== session.user.id);
    const mentionUserIds = [...new Set(payload.mentionUserIds)].filter((id) => id !== session.user.id);
    const viewerUserIds = payload.visibility === "SELECTED"
      ? [...new Set([...requestedViewerUserIds, ...mentionUserIds])]
      : [];
    const employeeUserIds = [...new Set([...viewerUserIds, ...mentionUserIds])];
    const productIds = [...new Set(payload.productIds)];

    const [employeeCount, productCount] = await Promise.all([
      prisma.user.count({ where: { id: { in: employeeUserIds }, isActive: true } }),
      prisma.product.count({ where: { id: { in: productIds } } }),
    ]);
    if (employeeCount !== employeeUserIds.length) {
      return NextResponse.json({ error: "Один из сотрудников не найден" }, { status: 400 });
    }
    if (productCount !== productIds.length) {
      return NextResponse.json({ error: "Один из товаров не найден" }, { status: 400 });
    }

    const savedFiles = await saveNoteFiles(files);
    try {
      const note = await prisma.note.create({
        data: {
          title: payload.title,
          content: payload.content,
          visibility: payload.visibility,
          createdByUserId: session.user.id,
          viewers: payload.visibility === "SELECTED"
            ? { create: viewerUserIds.map((userId) => ({ userId })) }
            : undefined,
          mentions: { create: mentionUserIds.map((userId) => ({ userId })) },
          products: { create: productIds.map((productId) => ({ productId })) },
          attachments: { create: savedFiles },
        },
        include: noteInclude,
      });
      return NextResponse.json(serializeNote(note), { status: 201 });
    } catch (error) {
      await removeNoteFiles(savedFiles.map((file) => file.storageKey));
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить заметку" },
      { status: 400 },
    );
  }
}
