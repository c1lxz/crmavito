import type {
  Note,
  NoteAttachment,
  NoteMention,
  NoteProduct,
  NoteViewer,
  Product,
  User,
} from "@prisma/client";

export type NoteWithRelations = Note & {
  createdBy: Pick<User, "id" | "name">;
  viewers: Array<NoteViewer & { user: Pick<User, "id" | "name"> }>;
  mentions: Array<NoteMention & { user: Pick<User, "id" | "name"> }>;
  attachments: NoteAttachment[];
  products: Array<NoteProduct & {
    product: Pick<Product, "id" | "name" | "imageUrl" | "avitoListingUrl" | "avitoItemId">;
  }>;
};

export const noteInclude = {
  createdBy: { select: { id: true, name: true } },
  viewers: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  },
  mentions: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  },
  attachments: { orderBy: { createdAt: "asc" } },
  products: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          avitoListingUrl: true,
          avitoItemId: true,
        },
      },
    },
    orderBy: { product: { name: "asc" } },
  },
} as const;

export function serializeNote(note: NoteWithRelations) {
  return {
    ...note,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    attachments: note.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: `/api/notes/files/${attachment.id}`,
    })),
  };
}
