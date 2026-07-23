import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { noteInclude, serializeNote } from "@/lib/notes/serialize";
import { removeNoteFiles, saveNoteFiles } from "@/lib/notes/storage";
import { parseNoteFormData } from "@/lib/notes/validation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.note.findUnique({
    where: { id },
    include: { attachments: true },
  });
  if (!existing) return NextResponse.json({ error: "Заметка не найдена" }, { status: 404 });
  if (existing.createdByUserId !== session.user.id) {
    return NextResponse.json({ error: "Редактировать заметку может только автор" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const payload = parseNoteFormData(formData);
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const viewerUserIds = [...new Set(payload.viewerUserIds)].filter((userId) => userId !== session.user.id);
    const productIds = [...new Set(payload.productIds)];
    const keepAttachmentIds = new Set(payload.keepAttachmentIds ?? []);
    const removedAttachments = existing.attachments.filter((item) => !keepAttachmentIds.has(item.id));
    const keptCount = existing.attachments.length - removedAttachments.length;
    if (keptCount + files.length > 6) {
      return NextResponse.json({ error: "Можно прикрепить не больше 6 файлов" }, { status: 400 });
    }

    const [viewerCount, productCount] = await Promise.all([
      payload.visibility === "SELECTED"
        ? prisma.user.count({ where: { id: { in: viewerUserIds }, isActive: true } })
        : Promise.resolve(0),
      prisma.product.count({ where: { id: { in: productIds } } }),
    ]);
    if (payload.visibility === "SELECTED" && viewerCount !== viewerUserIds.length) {
      return NextResponse.json({ error: "Один из сотрудников не найден" }, { status: 400 });
    }
    if (productCount !== productIds.length) {
      return NextResponse.json({ error: "Один из товаров не найден" }, { status: 400 });
    }

    const savedFiles = await saveNoteFiles(files);
    try {
      const note = await prisma.note.update({
        where: { id },
        data: {
          title: payload.title,
          content: payload.content,
          visibility: payload.visibility,
          viewers: {
            deleteMany: {},
            create: payload.visibility === "SELECTED"
              ? viewerUserIds.map((userId) => ({ userId }))
              : [],
          },
          products: {
            deleteMany: {},
            create: productIds.map((productId) => ({ productId })),
          },
          attachments: {
            deleteMany: { id: { in: removedAttachments.map((item) => item.id) } },
            create: savedFiles,
          },
        },
        include: noteInclude,
      });
      await removeNoteFiles(removedAttachments.map((item) => item.storageKey));
      return NextResponse.json(serializeNote(note));
    } catch (error) {
      await removeNoteFiles(savedFiles.map((file) => file.storageKey));
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось обновить заметку" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.note.findUnique({
    where: { id },
    include: { attachments: true },
  });
  if (!existing) return NextResponse.json({ error: "Заметка не найдена" }, { status: 404 });
  if (existing.createdByUserId !== session.user.id) {
    return NextResponse.json({ error: "Удалить заметку может только автор" }, { status: 403 });
  }

  await prisma.note.delete({ where: { id } });
  await removeNoteFiles(existing.attachments.map((item) => item.storageKey));
  return NextResponse.json({ ok: true });
}
