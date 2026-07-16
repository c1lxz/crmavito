"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  createdBy: { id: string; name: string };
  completedBy: { id: string; name: string } | null;
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
}

const emptyForm = () => ({
  title: "",
  description: "",
  assigneeUserId: "",
  dueAt: toDateTimeLocal(new Date(Date.now() + 60 * 60_000)),
  scheduled: false,
  scheduledAt: toDateTimeLocal(new Date()),
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

function notificationLabel(task: Task) {
  if (task.status === "COMPLETED") return "закрыто";
  if (!task.notification) return "ожидает";
  if (task.notification.status === "SENT") return "отправлено";
  if (task.notification.status === "RETRY") return "повтор";
  if (task.notification.status === "PROCESSING") return "отправка";
  return "ожидает";
}

export function TasksClient({ initialTasks, users }: Props) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "PLANNED" | "COMPLETED" | "ALL">("ACTIVE");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);

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
      return [task.title, task.description ?? "", task.assignee.name]
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
    setForm(emptyForm());
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          assigneeUserId: form.assigneeUserId,
          dueAt: toApiDate(form.dueAt),
          scheduledAt: form.scheduled ? toApiDate(form.scheduledAt) : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "Не удалось создать задачу");
      }
      toast({ title: "Задача создана" });
      closeCreate();
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
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Задачи</h1>
            <p className="section-caption">Личные поручения, сроки и Telegram-напоминания</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            Создать
          </Button>
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

      <div className="px-4 py-3 pb-24">
        <div className="pc-only hidden overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b bg-muted/55 text-xs text-muted-foreground">
              <tr>
                <th className="w-[34%] px-3 py-2 text-left font-medium">Задача</th>
                <th className="w-[18%] px-3 py-2 text-left font-medium">Ответственный</th>
                <th className="w-[18%] px-3 py-2 text-left font-medium">Срок</th>
                <th className="w-[14%] px-3 py-2 text-left font-medium">Бот</th>
                <th className="w-[16%] px-3 py-2 text-right font-medium">Действие</th>
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
                  </td>
                  <td className="px-3 py-3">{task.assignee.name}</td>
                  <td className="px-3 py-3">
                    <DueBadge task={task} />
                  </td>
                  <td className="px-3 py-3">
                    <NotificationBadge task={task} />
                  </td>
                  <td className="px-3 py-3 text-right">
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
                      <span className="text-xs text-muted-foreground">
                        {task.completedAt ? formatDateTime(task.completedAt) : "Выполнено"}
                      </span>
                    )}
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
              onComplete={() => completeTask(task)}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Новая задача</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
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
            <div className="space-y-1">
              <Label>Ответственный *</Label>
              <Select
                value={form.assigneeUserId}
                onValueChange={(value) => setForm((current) => ({ ...current, assigneeUserId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}{user.telegramId ? "" : " - без Telegram ID"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                disabled={loading || !form.title || !form.assigneeUserId || !form.dueAt}
              >
                {loading ? "Сохранение..." : "Создать"}
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

function NotificationBadge({ task }: { task: Task }) {
  return (
    <Badge variant={task.notification?.status === "RETRY" ? "warning" : "secondary"}>
      <Bell className="mr-1 h-3 w-3" />
      {notificationLabel(task)}
    </Badge>
  );
}

function TaskCard({
  task,
  loading,
  onComplete,
}: {
  task: Task;
  loading: boolean;
  onComplete: () => void;
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
            <span>{task.assignee.name}</span>
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
        <div className="mt-3 flex items-center justify-between gap-2">
          <NotificationBadge task={task} />
          {task.status === "OPEN" ? (
            <Button size="sm" disabled={loading} onClick={onComplete}>
              <Check className="h-4 w-4" />
              Готово
            </Button>
          ) : (
            <Badge variant="success">Выполнено</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
