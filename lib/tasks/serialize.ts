import type { Task, TaskAssignee, TaskNotification, User } from "@prisma/client";

export type TaskWithUsers = Task & {
  assignee: Pick<User, "id" | "name" | "telegramId">;
  assignees?: Array<
    Pick<
      TaskAssignee,
      "notificationStatus" | "lastError" | "notifiedAt" | "telegramMessageId"
    > & {
      user: Pick<User, "id" | "name" | "telegramId">;
    }
  >;
  createdBy: Pick<User, "id" | "name">;
  completedBy: Pick<User, "id" | "name"> | null;
  notification: Pick<
    TaskNotification,
    "status" | "sentAt" | "lastError" | "telegramMessageId"
  > | null;
};

export function serializeTask(task: TaskWithUsers) {
  const assignees =
    task.assignees?.map((assignee) => ({
      user: assignee.user,
      notificationStatus: assignee.notificationStatus,
      lastError: assignee.lastError,
      notifiedAt: assignee.notifiedAt?.toISOString() ?? null,
      telegramMessageId: assignee.telegramMessageId,
    })) ?? [{ user: task.assignee }];

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    scheduledAt: task.scheduledAt?.toISOString() ?? null,
    dueAt: task.dueAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    assignee: task.assignee,
    assignees,
    createdBy: task.createdBy,
    completedBy: task.completedBy,
    notification: task.notification
      ? {
          ...task.notification,
          sentAt: task.notification.sentAt?.toISOString() ?? null,
        }
      : null,
  };
}
