import { Suspense } from "react";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { NotebookClient } from "@/components/notebook/notebook-client";
import { serializeTask } from "@/lib/tasks/serialize";
import { noteInclude, serializeNote } from "@/lib/notes/serialize";

export const dynamic = "force-dynamic";

const taskInclude = {
  assignee: { select: { id: true, name: true, telegramId: true } },
  assignees: {
    include: { user: { select: { id: true, name: true, telegramId: true } } },
    orderBy: { createdAt: "asc" },
  },
  createdBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  attachments: { orderBy: { createdAt: "asc" } },
  notification: {
    select: {
      status: true,
      sentAt: true,
      lastError: true,
      telegramMessageId: true,
    },
  },
} as const;

async function getTasks() {
  const tasks = await prisma.task.findMany({
    include: taskInclude,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
  return tasks.map(serializeTask);
}

async function getUsers() {
  return prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, telegramId: true },
  });
}

export default async function TasksPage() {
  const session = await auth();
  const currentUserId = session?.user?.id ?? "";
  const [tasks, users, notes, products] = await Promise.all([
    getTasks(),
    getUsers(),
    prisma.note.findMany({
      where: {
        OR: [
          { visibility: "ALL" },
          { createdByUserId: currentUserId },
          { viewers: { some: { userId: currentUserId } } },
        ],
      },
      include: noteInclude,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        avitoListingUrl: true,
        avitoItemId: true,
      },
    }),
  ]);

  return (
    <Suspense fallback={<div className="p-4 text-center">Загрузка...</div>}>
      <NotebookClient
        initialNotes={notes.map(serializeNote)}
        initialTasks={tasks}
        users={users}
        products={products}
        currentUserId={currentUserId}
        isAdmin={session?.user?.role === "ADMIN"}
      />
    </Suspense>
  );
}
