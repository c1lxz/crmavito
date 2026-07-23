"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/hooks/use-toast";
import { cn, formatDateTime } from "@/lib/utils";

type TaskStatus = "OPEN" | "COMPLETED";

interface TaskUser {
  id: string;
  name: string;
  telegramId?: string | null;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  scheduledAt: string | null;
  dueAt: string;
  completedAt: string | null;
  createdAt: string;
  assignee: TaskUser;
  assignees: Array<{
    user: TaskUser;
    notificationStatus?: string;
    lastError?: string | null;
    notifiedAt?: string | null;
    telegramMessageId?: number | null;
  }>;
  createdBy: { id: string; name: string };
  completedBy: { id: string; name: string } | null;
  attachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    url: string;
  }>;
  notification: {
    status: string;
    sentAt: Date | string | null;
    lastError: string | null;
    telegramMessageId: number | null;
  } | null;
}

interface Props {
  initialTasks: Task[];
  users: TaskUser[];
  isAdmin: boolean;
  embedded?: boolean;
  createSignal?: number;
}

const emptyForm = () => ({
  title: "",
  description: "",
  assigneeUserIds: [] as string[],
  dueAt: toDateTimeLocal(new Date(Date.now() + 60 * 60_000)),
  scheduled: false,
  scheduledAt: toDateTimeLocal(new Date()),
  keepAttachmentIds: [] as string[],
  files: [] as File[],
});

function toDateTimeLocal(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function toApiDate(value: string) {
  return new Date(value).toISOString();
}

function isOverdue(task: Task) {
  return task.status === "OPEN" && new Date(task.dueAt).getTime() < Date.now();
}

function isPlanned(task: Task) {
  return (
    task.status === "OPEN" &&
    task.scheduledAt !== null &&
    new Date(task.scheduledAt).getTime() > Date.now()
  );
}

function assigneeNames(task: Task) {
  const assignees = task.assignees?.length ? task.assignees : [{ user: task.assignee }];
  return assignees.map((assignee) => assignee.user.name).join(", ");
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

export function TasksClient({
  initialTasks,
  users,
  isAdmin,
  embedded = false,
  createSignal = 0,
}: Props) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "PLANNED" | "COMPLETED" | "ALL">("ACTIVE");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (createSignal > 0 && isAdmin) {
      setEditingTask(null);
      setForm(emptyForm());
      setShowCreate(true);
    }
  }, [createSignal, isAdmin]);

  const stats = useMemo(() => {
    return {
      active: tasks.filter((task) => task.status === "OPEN" && !isPlanned(task)).length,
      planned: tasks.filter(isPlanned).length,
      overdue: tasks.filter(isOverdue).length,
      completed: tasks.filter((task) => task.status === "COMPLETED").length,
    };
  }, [tasks]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (statusFilter === "ACTIVE" && (task.status !== "OPEN" || isPlanned(task))) return false;
      if (statusFilter === "PLANNED" && !isPlanned(task)) return false;
      if (statusFilter === "COMPLETED" && task.status !== "COMPLETED") return false;
      if (!query) return true;
      return [task.title, task.description ?? "", assigneeNames(task)]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [search, statusFilter, tasks]);

  async function refreshTasks() {
    const res = await fetch("/api/tasks", { cache: "no-store" });
    if (!res.ok) throw new Error("Не удалось обновить задачи");
    const data = (await res.json()) as { tasks: Task[] };
    setTasks(data.tasks);
  }

  function closeCreate() {
    setShowCreate(false);
    setEditingTask(null);
    setForm(emptyForm());
  }

  function openEdit(task: Task) {
    setEditingTask(task);
    setForm({
      title: task.title,
      description: task.description ?? "",
      assigneeUserIds: task.assignees?.length
        ? task.assignees.map((assignee) => assignee.user.id)
        : [task.assignee.id],
      dueAt: toDateTimeLocal(new Date(task.dueAt)),
      scheduled: Boolean(task.scheduledAt),
      scheduledAt: toDateTimeLocal(task.scheduledAt ? new Date(task.scheduledAt) : new Date()),
      keepAttachmentIds: task.attachments.map((attachment) => attachment.id),
      files: [],
    });
    setShowCreate(true);
  }

  function toggleAssignee(userId: string) {
    setForm((current) => ({
      ...current,
      assigneeUserIds: current.assigneeUserIds.includes(userId)
        ? current.assigneeUserIds.filter((id) => id !== userId)
        : [...current.assigneeUserIds, userId],
    }));
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const total = form.keepAttachmentIds.length + form.files.length + incoming.length;
    if (total > 6) {
      toast({
        title: "Слишком много файлов",
        description: "К одной задаче можно прикрепить до 6 файлов.",
        variant: "destructive",
      });
      return;
    }
    const oversized = incoming.find((file) => file.size > 300 * 1024 * 1024);
    if (oversized) {
      toast({
        title: "Файл слишком большой",
        description: `${oversized.name}: максимальный размер — 300 МБ.`,
        variant: "destructive",
      });
      return;
    }
    setForm((current) => ({ ...current, files: [...current.files, ...incoming] }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isAdmin) return;
    setLoading(true);
    try {
      const body = new FormData();
      body.set(
        "payload",
        JSON.stringify({
          title: form.title,
          description: form.description,
          assigneeUserIds: form.assigneeUserIds,
          dueAt: toApiDate(form.dueAt),
          scheduledAt: form.scheduled ? toApiDate(form.scheduledAt) : null,
          ...(editingTask ? { keepAttachmentIds: form.keepAttachmentIds } : {}),
        }),
      );
      form.files.forEach((file) => body.append("files", file));
      const res = await fetch(editingTask ? `/api/tasks/${editingTask.id}` : "/api/tasks", {
        method: editingTask ? "PATCH" : "POST",
        body,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "Не удалось создать задачу");
      }
      const savedTask = (await res.json()) as Task;
      setTasks((current) => {
        const updated = editingTask
          ? current.map((task) => (task.id === savedTask.id ? savedTask : task))
          : [...current, savedTask];
        return updated.sort(
          (left, right) =>
            left.status.localeCompare(right.status) ||
            new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
        );
      });
      toast({ title: editingTask ? "Задача обновлена" : "Задача создана" });
      closeCreate();
      router.refresh();
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function deleteTask(task: Task) {
    if (!isAdmin || !window.confirm(`Удалить задачу "${task.title}"?`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Не удалось удалить задачу");
      toast({ title: "Задача удалена" });
      await refreshTasks();
      router.refresh();
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function completeTask(task: Task) {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      if (!res.ok) throw new Error("Не удалось выполнить задачу");
      toast({ title: "Задача выполнена", description: "Уведомление в Telegram будет удалено." });
      await refreshTasks();
      router.refresh();
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={embedded ? "min-h-0" : "app-shell"}>
      <div className={embedded ? "notebook-task-toolbar border-b border-border/80 bg-background px-4 py-4" : "app-header"}>
        <div className={embedded ? "hidden" : "mb-3 flex items-start justify-between gap-3"}>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Задачи</h1>
            <p className="section-caption">Личные поручения, сроки и Telegram-напоминания</p>
          </div>
          {isAdmin ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              Создать
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-4 gap-2">
          <TaskStat label="Активные" value={stats.active} icon={ClipboardList} />
          <TaskStat label="План" value={stats.planned} icon={CalendarClock} />
          <TaskStat label="Просрочено" value={stats.overdue} icon={Clock3} warning />
          <TaskStat label="Готово" value={stats.completed} icon={CheckCircle2} />
        </div>

        <div className="mt-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Поиск по задачам"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {[
              ["ACTIVE", "Активные"],
              ["PLANNED", "Запланированные"],
              ["COMPLETED", "Выполненные"],
              ["ALL", "Все"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value as typeof statusFilter)}
                className={`filter-chip ${statusFilter === value ? "filter-chip-active" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={embedded ? "notebook-task-content px-4 py-4 pb-24" : "px-4 py-3 pb-24"}>
        <div className="pc-only hidden overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b bg-muted/55 text-xs text-muted-foreground">
              <tr>
                <th className="w-[36%] px-3 py-2 text-left font-medium">Задача</th>
                <th className="w-[24%] px-3 py-2 text-left font-medium">Ответственные</th>
                <th className="w-[18%] px-3 py-2 text-left font-medium">Срок</th>
                <th className="w-[22%] px-3 py-2 text-right font-medium">Действие</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <tr key={task.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <p className="font-medium">{task.title}</p>
                    {task.description ? (
                      <p className="truncate text-xs text-muted-foreground">{task.description}</p>
                    ) : null}
                    <TaskAttachments attachments={task.attachments} />
                  </td>
                  <td className="px-3 py-3">{assigneeNames(task)}</td>
                  <td className="px-3 py-3">
                    <DueBadge task={task} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {task.status === "OPEN" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={loading}
                          onClick={() => completeTask(task)}
                        >
                          <Check className="h-4 w-4" />
                          Готово
                        </Button>
                      ) : (
                        <span className="self-center text-xs text-muted-foreground">
                          {task.completedAt ? formatDateTime(task.completedAt) : "Выполнено"}
                        </span>
                      )}
                      {isAdmin ? (
                        <>
                          <Button size="sm" variant="outline" disabled={loading} onClick={() => openEdit(task)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" disabled={loading} onClick={() => deleteTask(task)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mobile-only space-y-3">
          {filtered.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              loading={loading}
              isAdmin={isAdmin}
              onComplete={() => completeTask(task)}
              onEdit={() => openEdit(task)}
              onDelete={() => deleteTask(task)}
            />
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted">
              <ClipboardList className="h-8 w-8 text-muted-foreground/70" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium">Задач не найдено</p>
          </div>
        ) : null}
      </div>

      <Dialog open={showCreate} onOpenChange={(open) => !open && closeCreate()}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTask ? "Редактировать задачу" : "Новая задача"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label>Название *</Label>
              <Input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Проверить оплату поставщику"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Описание</Label>
              <Textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                placeholder="Контекст, детали, ссылка на заказ..."
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Файлы</Label>
                <span className="text-xs text-muted-foreground">
                  {form.keepAttachmentIds.length + form.files.length}/6
                </span>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary/60 hover:text-foreground focus-within:ring-2 focus-within:ring-ring">
                <Paperclip className="h-4 w-4" />
                Прикрепить файлы
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Фото, PDF, документы, таблицы или ZIP — до 300 МБ каждый.
              </p>
              {editingTask?.attachments.length || form.files.length ? (
                <div className="space-y-1.5">
                  {editingTask?.attachments
                    .filter((attachment) => form.keepAttachmentIds.includes(attachment.id))
                    .map((attachment) => (
                      <FileRow
                        key={attachment.id}
                        name={attachment.name}
                        size={attachment.size}
                        href={attachment.url}
                        onRemove={() =>
                          setForm((current) => ({
                            ...current,
                            keepAttachmentIds: current.keepAttachmentIds.filter(
                              (id) => id !== attachment.id,
                            ),
                          }))
                        }
                      />
                    ))}
                  {form.files.map((file, index) => (
                    <FileRow
                      key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                      name={file.name}
                      size={file.size}
                      onRemove={() =>
                        setForm((current) => ({
                          ...current,
                          files: current.files.filter((_, fileIndex) => fileIndex !== index),
                        }))
                      }
                    />
                  ))}
                </div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>Ответственные *</Label>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {users.map((user) => (
                  <label key={user.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/70">
                    <input
                      type="checkbox"
                      checked={form.assigneeUserIds.includes(user.id)}
                      onChange={() => toggleAssignee(user.id)}
                      className="h-4 w-4"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {user.name}{user.telegramId ? "" : " - без Telegram ID"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Срок *</Label>
              <Input
                type="datetime-local"
                value={form.dueAt}
                onChange={(event) => setForm((current) => ({ ...current, dueAt: event.target.value }))}
                required
              />
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.scheduled}
                onChange={(event) => setForm((current) => ({ ...current, scheduled: event.target.checked }))}
                className="h-4 w-4"
              />
              Запланировать уведомление на другое время
            </label>
            {form.scheduled ? (
              <div className="space-y-1">
                <Label>Когда отправить уведомление</Label>
                <Input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))}
                />
              </div>
            ) : null}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={closeCreate}>
                Отмена
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={loading || !form.title || form.assigneeUserIds.length === 0 || !form.dueAt}
              >
                {loading ? "Сохранение..." : editingTask ? "Сохранить" : "Создать"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskStat({
  label,
  value,
  icon: Icon,
  warning = false,
}: {
  label: string;
  value: number;
  icon: typeof ClipboardList;
  warning?: boolean;
}) {
  return (
    <Card className={cn("border-border/70", warning && value > 0 ? "border-destructive/30 bg-destructive/5" : "")}>
      <CardContent className="p-2">
        <div className="mb-1 flex items-center justify-between text-muted-foreground">
          <span className="text-[10px] leading-none">{label}</span>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function DueBadge({ task }: { task: Task }) {
  const overdue = isOverdue(task);
  const planned = isPlanned(task);
  return (
    <Badge variant={task.status === "COMPLETED" ? "success" : overdue ? "destructive" : planned ? "info" : "warning"}>
      {task.status === "COMPLETED"
        ? "выполнено"
        : overdue
          ? "просрочено"
          : planned
            ? "план"
            : formatDateTime(task.dueAt)}
    </Badge>
  );
}

function TaskCard({
  task,
  loading,
  isAdmin,
  onComplete,
  onEdit,
  onDelete,
}: {
  task: Task;
  loading: boolean;
  isAdmin: boolean;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className={cn(isOverdue(task) && "border-destructive/35")}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium leading-tight">{task.title}</p>
            {task.description ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
            ) : null}
          </div>
          <DueBadge task={task} />
        </div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            <span>{assigneeNames(task)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            <span>Срок: {formatDateTime(task.dueAt)}</span>
          </div>
          {task.scheduledAt ? (
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              <span>Уведомить: {formatDateTime(task.scheduledAt)}</span>
            </div>
          ) : null}
        </div>
        <TaskAttachments attachments={task.attachments} />
        <div className="mt-3 flex items-center justify-end gap-2">
          {task.status === "OPEN" ? (
            <Button size="sm" disabled={loading} onClick={onComplete}>
              <Check className="h-4 w-4" />
              Готово
            </Button>
          ) : (
            <Badge variant="success">Выполнено</Badge>
          )}
          {isAdmin ? (
            <>
              <Button size="sm" variant="outline" disabled={loading} onClick={onEdit}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" disabled={loading} onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function TaskAttachments({ attachments }: { attachments: Task["attachments"] }) {
  if (attachments.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <a
          key={attachment.id}
          href={attachment.url}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-secondary/45 px-2 py-1 text-xs text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`Скачать ${attachment.name}`}
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="max-w-48 truncate">{attachment.name}</span>
          <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </a>
      ))}
    </div>
  );
}

function FileRow({
  name,
  size,
  href,
  onRemove,
}: {
  name: string;
  size: number;
  href?: string;
  onRemove: () => void;
}) {
  const content = (
    <>
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatFileSize(size)}
      </span>
    </>
  );

  return (
    <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-secondary/35 pl-2.5 pr-1.5">
      {href ? (
        <a
          href={href}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`Скачать ${name}`}
        >
          {content}
        </a>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">{content}</div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Убрать файл ${name}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
