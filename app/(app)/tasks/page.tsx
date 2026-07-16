import { Suspense } from "react";
import { prisma } from "@/lib/db/prisma";
import { TasksClient } from "@/components/tasks/tasks-client";
import { serializeTask } from "@/lib/tasks/serialize";

export const dynamic = "force-dynamic";

const taskInclude = {
  assignee: { select: { id: true, name: true, telegramId: true } },
  createdBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
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
  const [tasks, users] = await Promise.all([getTasks(), getUsers()]);

  return (
    <Suspense fallback={<div className="p-4 text-center">Загрузка...</div>}>
      <TasksClient initialTasks={tasks} users={users} />
    </Suspense>
  );
}
