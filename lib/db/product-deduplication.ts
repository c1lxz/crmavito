import type { PrismaClient } from "@prisma/client";
import { normalizeProductName } from "@/lib/avito/sync";

export async function prepareProductNames(prisma: PrismaClient): Promise<number> {
  const products = await prisma.product.findMany({
    where: { normalizedName: null },
    select: { id: true, name: true },
  });
  if (products.length === 0) return 0;

  await prisma.$transaction(
    products.map((product) => prisma.product.update({
      where: { id: product.id },
      data: { normalizedName: normalizeProductName(product.name) || null },
    })),
  );
  return products.length;
}

export async function consolidateDuplicateProducts(prisma: PrismaClient): Promise<number> {
  const products = await prisma.product.findMany({
    where: { normalizedName: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      normalizedName: true,
      _count: {
        select: { orders: true, orderItems: true, returns: true, notes: true, avitoListings: true },
      },
    },
  });
  const groups = new Map<string, typeof products>();
  for (const product of products) {
    if (!product.normalizedName) continue;
    const group = groups.get(product.normalizedName) ?? [];
    group.push(product);
    groups.set(product.normalizedName, group);
  }

  let merged = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => {
      const score = (item: typeof a) => item._count.orders * 5 + item._count.orderItems * 3 + item._count.returns * 3 + item._count.notes + item._count.avitoListings * 2;
      return score(b) - score(a);
    });
    const primary = ranked[0];

    await prisma.$transaction(async (tx) => {
      const primaryNotes = await tx.noteProduct.findMany({
        where: { productId: primary.id },
        select: { noteId: true },
      });
      const occupiedNoteIds = new Set(primaryNotes.map((item) => item.noteId));

      for (const duplicate of ranked.slice(1)) {
        const duplicateNotes = await tx.noteProduct.findMany({
          where: { productId: duplicate.id },
          select: { noteId: true },
        });
        const conflictingNoteIds = duplicateNotes
          .map((item) => item.noteId)
          .filter((noteId) => occupiedNoteIds.has(noteId));
        if (conflictingNoteIds.length) {
          await tx.noteProduct.deleteMany({
            where: { productId: duplicate.id, noteId: { in: conflictingNoteIds } },
          });
        }

        await tx.order.updateMany({ where: { productId: duplicate.id }, data: { productId: primary.id } });
        await tx.orderItem.updateMany({ where: { productId: duplicate.id }, data: { productId: primary.id } });
        await tx.return.updateMany({ where: { productId: duplicate.id }, data: { productId: primary.id } });
        await tx.noteProduct.updateMany({ where: { productId: duplicate.id }, data: { productId: primary.id } });
        await tx.productAvitoListing.updateMany({ where: { productId: duplicate.id }, data: { productId: primary.id } });
        await tx.product.delete({ where: { id: duplicate.id } });

        duplicateNotes.forEach((item) => occupiedNoteIds.add(item.noteId));
        merged++;
      }
    });
  }
  return merged;
}
