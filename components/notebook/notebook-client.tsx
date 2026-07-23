"use client";

import { useMemo, useRef, useState } from "react";
import {
  AtSign,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  File,
  FilePlus2,
  Globe2,
  Link2,
  LockKeyhole,
  NotebookPen,
  PackageSearch,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { TasksClient } from "@/components/tasks/tasks-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";

type User = { id: string; name: string; telegramId?: string | null };
type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
  avitoListingUrl: string | null;
  avitoItemId: string | null;
};
type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
};
type Note = {
  id: string;
  title: string;
  content: string;
  visibility: "ALL" | "SELECTED";
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string };
  viewers: Array<{ user: { id: string; name: string } }>;
  mentions: Array<{
    user: { id: string; name: string };
    status: string;
  }>;
  attachments: Attachment[];
  products: Array<{ product: Product }>;
};

type Task = React.ComponentProps<typeof TasksClient>["initialTasks"];

interface Props {
  initialNotes: Note[];
  initialTasks: Task;
  users: User[];
  products: Product[];
  currentUserId: string;
  isAdmin: boolean;
}

const emptyNoteForm = () => ({
  title: "",
  content: "",
  visibility: "ALL" as "ALL" | "SELECTED",
  viewerUserIds: [] as string[],
  mentionUserIds: [] as string[],
  productIds: [] as string[],
  keepAttachmentIds: [] as string[],
  files: [] as File[],
});

export function NotebookClient({
  initialNotes,
  initialTasks,
  users,
  products,
  currentUserId,
  isAdmin,
}: Props) {
  const [section, setSection] = useState<"notes" | "tasks">("notes");
  const [notes, setNotes] = useState(initialNotes);
  const [search, setSearch] = useState("");
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [taskCreateSignal, setTaskCreateSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [form, setForm] = useState(emptyNoteForm);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter((note) =>
      [
        note.title,
        note.content,
        note.createdBy.name,
        ...note.products.map(({ product }) => product.name),
      ].join(" ").toLowerCase().includes(query),
    );
  }, [notes, search]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    return products
      .filter((product) => !query || product.name.toLowerCase().includes(query))
      .slice(0, 30);
  }, [productSearch, products]);

  function openNewNote() {
    setCreateChoiceOpen(false);
    setEditingNote(null);
    setForm(emptyNoteForm());
    setShowPeople(false);
    setShowMentions(false);
    setShowProducts(false);
    setEditorOpen(true);
  }

  function openNewTask() {
    setCreateChoiceOpen(false);
    setSection("tasks");
    setTaskCreateSignal((value) => value + 1);
  }

  function openEdit(note: Note) {
    setViewingNote(null);
    setEditingNote(note);
    setForm({
      title: note.title,
      content: note.content,
      visibility: note.visibility,
      viewerUserIds: note.viewers.map(({ user }) => user.id),
      mentionUserIds: note.mentions.map(({ user }) => user.id),
      productIds: note.products.map(({ product }) => product.id),
      keepAttachmentIds: note.attachments.map((attachment) => attachment.id),
      files: [],
    });
    setShowPeople(note.visibility === "SELECTED");
    setShowMentions(note.mentions.length > 0);
    setShowProducts(note.products.length > 0);
    setEditorOpen(true);
  }

  function toggleId(key: "viewerUserIds" | "mentionUserIds" | "productIds", id: string) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((value) => value !== id)
        : [...current[key], id],
    }));
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const next = [...form.files, ...Array.from(fileList)];
    const total = next.length + form.keepAttachmentIds.length;
    if (total > 6) {
      toast({ title: "Не больше 6 файлов", variant: "destructive" });
      return;
    }
    setForm((current) => ({ ...current, files: next }));
  }

  async function refreshNotes() {
    const response = await fetch("/api/notes", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось обновить заметки");
    const data = (await response.json()) as { notes: Note[] };
    setNotes(data.notes);
  }

  async function saveNote(event: React.FormEvent) {
    event.preventDefault();
    if (
      form.visibility === "SELECTED" &&
      form.viewerUserIds.length === 0 &&
      form.mentionUserIds.length === 0
    ) {
      setShowPeople(true);
      toast({ title: "Выберите, кому видна заметка", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body = new FormData();
      body.set("payload", JSON.stringify({
        title: form.title,
        content: form.content,
        visibility: form.visibility,
        viewerUserIds: form.viewerUserIds,
        mentionUserIds: form.mentionUserIds,
        productIds: form.productIds,
        keepAttachmentIds: form.keepAttachmentIds,
      }));
      form.files.forEach((file) => body.append("files", file));
      const response = await fetch(editingNote ? `/api/notes/${editingNote.id}` : "/api/notes", {
        method: editingNote ? "PATCH" : "POST",
        body,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Не удалось сохранить заметку");
      }
      await refreshNotes();
      setEditorOpen(false);
      setEditingNote(null);
      toast({
        title: editingNote ? "Заметка обновлена" : "Заметка сохранена",
        description: form.mentionUserIds.length > 0
          ? "Новые отмеченные сотрудники получат уведомление в Telegram."
          : undefined,
      });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(note: Note) {
    if (!window.confirm(`Удалить заметку «${note.title}»?`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Не удалось удалить заметку");
      setViewingNote(null);
      await refreshNotes();
      toast({ title: "Заметка удалена" });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const editorAttachments = editingNote?.attachments.filter((attachment) =>
    form.keepAttachmentIds.includes(attachment.id),
  ) ?? [];

  return (
    <div className="app-shell">
      <header className="app-header notebook-header">
        <div className="notebook-header-row flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Блокнот</h1>
            <p className="section-caption">Заметки, ссылки и задачи в одном месте</p>
          </div>
          <Button size="sm" onClick={() => setCreateChoiceOpen(true)}>
            <Plus className="h-4 w-4" />
            Создать
          </Button>
        </div>
        <div className="mt-4 flex w-full max-w-sm rounded-lg bg-secondary p-1" role="tablist">
          <button
            role="tab"
            aria-selected={section === "notes"}
            className={cn(
              "flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors",
              section === "notes" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setSection("notes")}
          >
            <NotebookPen className="h-4 w-4" />
            Заметки
            <span className="text-xs tabular-nums text-muted-foreground">{notes.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={section === "tasks"}
            className={cn(
              "flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors",
              section === "tasks" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setSection("tasks")}
          >
            <ClipboardList className="h-4 w-4" />
            Задачи
          </button>
        </div>
      </header>

      {section === "notes" ? (
        <main className="notebook-content app-content">
          <div className="notebook-toolbar mb-4 flex items-center gap-3">
            <div className="relative w-full max-w-xl">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Найти заметку или товар"
              />
            </div>
          </div>

          {filteredNotes.length > 0 ? (
            <div className="notebook-notes-grid">
              {filteredNotes.map((note) => (
                <article
                  key={note.id}
                  className="group flex min-h-44 cursor-pointer flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-within:border-primary/40"
                  onClick={() => setViewingNote(note)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="line-clamp-2 text-base font-semibold leading-snug">{note.title}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {note.createdBy.name} · {formatRelativeDate(note.updatedAt)}
                      </p>
                    </div>
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground"
                      title={note.visibility === "ALL" ? "Видно всем" : "Ограниченный доступ"}
                    >
                      {note.visibility === "ALL" ? <Globe2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                    </span>
                  </div>
                  <p className="mt-4 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-foreground/80">
                    {note.content}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                    {note.products.length > 0 ? (
                      <Badge variant="info">
                        <PackageSearch className="mr-1 h-3 w-3" />
                        {note.products.length} {plural(note.products.length, "товар", "товара", "товаров")}
                      </Badge>
                    ) : null}
                    {note.attachments.length > 0 ? (
                      <Badge variant="secondary">
                        <Paperclip className="mr-1 h-3 w-3" />
                        {note.attachments.length}
                      </Badge>
                    ) : null}
                    {note.mentions.length > 0 ? (
                      <Badge variant="secondary">
                        <AtSign className="mr-1 h-3 w-3" />
                        {note.mentions.length}
                      </Badge>
                    ) : null}
                    {note.visibility === "SELECTED" ? (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {note.viewers.slice(0, 2).map(({ user }) => user.name).join(", ")}
                        {note.viewers.length > 2 ? ` +${note.viewers.length - 2}` : ""}
                      </span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                <NotebookPen className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-sm font-semibold">
                {search ? "Ничего не найдено" : "Сохраните первую заметку"}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {search
                  ? "Попробуйте изменить запрос"
                  : "Добавьте важную информацию, товар или файл — всё останется под рукой."}
              </p>
              {!search ? (
                <Button className="mt-4" size="sm" onClick={openNewNote}>
                  <Plus className="h-4 w-4" />
                  Новая заметка
                </Button>
              ) : null}
            </div>
          )}
        </main>
      ) : (
        <TasksClient
          initialTasks={initialTasks}
          users={users}
          isAdmin={isAdmin}
          embedded
          createSignal={taskCreateSignal}
        />
      )}

      <Dialog open={createChoiceOpen} onOpenChange={setCreateChoiceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Что создать?</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <button
              className="flex items-center gap-4 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/35 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={openNewNote}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <NotebookPen className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Написать заметку</span>
                <span className="block text-sm text-muted-foreground">Текст, товары, файлы и доступ</span>
              </span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
            <button
              className={cn(
                "flex items-center gap-4 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/35 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !isAdmin && "cursor-not-allowed opacity-50",
              )}
              disabled={!isAdmin}
              onClick={openNewTask}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                <ClipboardList className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Поставить задачу</span>
                <span className="block text-sm text-muted-foreground">
                  {isAdmin ? "Ответственный, срок и напоминание" : "Доступно администратору"}
                </span>
              </span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!saving) setEditorOpen(open);
        }}
      >
        <DialogContent className="notebook-editor max-w-2xl p-0">
          <DialogHeader className="border-b px-5 pb-4 pt-5">
            <DialogTitle>{editingNote ? "Редактировать заметку" : "Новая заметка"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveNote}>
            <div className="space-y-4 px-5 pb-5">
              <div className="space-y-2">
                <Label htmlFor="note-title">Название</Label>
                <Input
                  id="note-title"
                  autoFocus
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Например, условия работы с поставщиком"
                  maxLength={160}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="note-content">Заметка</Label>
                <Textarea
                  id="note-content"
                  className="min-h-40 resize-y leading-6"
                  value={form.content}
                  onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                  placeholder="Запишите важное. Ссылки можно вставлять прямо в текст…"
                  maxLength={50_000}
                  required
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={showPeople || form.visibility === "SELECTED" ? "secondary" : "outline"}
                  onClick={() => setShowPeople((value) => !value)}
                >
                  {form.visibility === "ALL" ? <Globe2 className="h-4 w-4" /> : <UsersRound className="h-4 w-4" />}
                  {form.visibility === "ALL" ? "Видно всем" : `Доступ: ${form.viewerUserIds.length}`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={showMentions || form.mentionUserIds.length > 0 ? "secondary" : "outline"}
                  onClick={() => setShowMentions((value) => !value)}
                >
                  <AtSign className="h-4 w-4" />
                  {form.mentionUserIds.length > 0
                    ? `Отмечены: ${form.mentionUserIds.length}`
                    : "Отметить сотрудников"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={showProducts || form.productIds.length > 0 ? "secondary" : "outline"}
                  onClick={() => setShowProducts((value) => !value)}
                >
                  <PackageSearch className="h-4 w-4" />
                  {form.productIds.length > 0 ? `Товары: ${form.productIds.length}` : "Добавить товары"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <FilePlus2 className="h-4 w-4" />
                  Прикрепить файл
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="sr-only"
                  accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>

              {showPeople ? (
                <section className="rounded-lg border border-border bg-secondary/35 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
                        form.visibility === "ALL" ? "border-primary bg-card text-primary" : "border-transparent text-muted-foreground hover:bg-card",
                      )}
                      onClick={() => setForm((current) => ({ ...current, visibility: "ALL" }))}
                    >
                      <Globe2 className="h-4 w-4" />
                      Всем
                      {form.visibility === "ALL" ? <Check className="ml-auto h-4 w-4" /> : null}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
                        form.visibility === "SELECTED" ? "border-primary bg-card text-primary" : "border-transparent text-muted-foreground hover:bg-card",
                      )}
                      onClick={() => setForm((current) => ({ ...current, visibility: "SELECTED" }))}
                    >
                      <LockKeyhole className="h-4 w-4" />
                      Выбранным
                      {form.visibility === "SELECTED" ? <Check className="ml-auto h-4 w-4" /> : null}
                    </button>
                  </div>
                  {form.visibility === "SELECTED" ? (
                    <div className="mt-3 max-h-40 space-y-1 overflow-y-auto">
                      {users.filter((user) => user.id !== currentUserId).map((user) => (
                        <label key={user.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-card">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={form.viewerUserIds.includes(user.id)}
                            onChange={() => toggleId("viewerUserIds", user.id)}
                          />
                          <span className="truncate">{user.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {showMentions ? (
                <section className="rounded-lg border border-border bg-secondary/35 p-3">
                  <div className="mb-2 flex items-start gap-2">
                    <AtSign className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">Кого уведомить</p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Бот сообщит сотрудникам, что их отметили. В закрытой заметке они автоматически получат доступ.
                      </p>
                    </div>
                  </div>
                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {users.filter((user) => user.id !== currentUserId).map((user) => (
                      <label
                        key={user.id}
                        className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-card"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={form.mentionUserIds.includes(user.id)}
                          onChange={() => toggleId("mentionUserIds", user.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">{user.name}</span>
                        {!user.telegramId ? (
                          <span className="text-xs text-muted-foreground">нет Telegram ID</span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </section>
              ) : null}

              {showProducts ? (
                <section className="rounded-lg border border-border bg-secondary/35 p-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="bg-card pl-9"
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Найти товар"
                    />
                  </div>
                  <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                    {filteredProducts.map((product) => (
                      <label key={product.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-card">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={form.productIds.includes(product.id)}
                          onChange={() => toggleId("productIds", product.id)}
                        />
                        <ProductThumb product={product} />
                        <span className="min-w-0 flex-1 truncate">{product.name}</span>
                        {product.avitoListingUrl ? <Link2 className="h-4 w-4 text-muted-foreground" /> : null}
                      </label>
                    ))}
                    {filteredProducts.length === 0 ? (
                      <p className="px-2 py-4 text-center text-sm text-muted-foreground">Товары не найдены</p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {editorAttachments.length > 0 || form.files.length > 0 ? (
                <section className="space-y-2">
                  {[...editorAttachments.map((attachment) => ({ ...attachment, existing: true as const })),
                    ...form.files.map((file, index) => ({
                      id: `new-${index}`,
                      name: file.name,
                      size: file.size,
                      existing: false as const,
                      index,
                    }))].map((item) => (
                    <div key={item.id} className="flex min-h-11 items-center gap-3 rounded-md bg-secondary/60 px-3">
                      <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(item.size)}</span>
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
                        aria-label={`Убрать ${item.name}`}
                        onClick={() => {
                          if (item.existing) {
                            setForm((current) => ({
                              ...current,
                              keepAttachmentIds: current.keepAttachmentIds.filter((id) => id !== item.id),
                            }));
                          } else {
                            setForm((current) => ({
                              ...current,
                              files: current.files.filter((_, index) => index !== item.index),
                            }));
                          }
                        }}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-card px-5 py-4">
              <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)} disabled={saving}>
                Отмена
              </Button>
              <Button type="submit" disabled={saving || form.title.trim().length < 2 || !form.content.trim()}>
                {saving ? "Сохранение…" : editingNote ? "Сохранить" : "Добавить заметку"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewingNote)} onOpenChange={(open) => !open && setViewingNote(null)}>
        {viewingNote ? (
          <DialogContent className="max-w-2xl p-0">
            <div className="border-b px-5 pb-4 pt-5 pr-14">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-xl leading-snug">{viewingNote.title}</DialogTitle>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {viewingNote.createdBy.name} · обновлено {formatRelativeDate(viewingNote.updatedAt)}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-6 px-5 py-5">
              <div className="whitespace-pre-wrap break-words text-sm leading-7">
                {renderNoteContent(viewingNote.content)}
              </div>

              {viewingNote.products.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Товары</h3>
                  <div className="space-y-2">
                    {viewingNote.products.map(({ product }) => (
                      <div key={product.id} className="flex min-h-12 items-center gap-3 rounded-md bg-secondary/55 px-3 py-2">
                        <ProductThumb product={product} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</span>
                        {product.avitoListingUrl ? (
                          <Button asChild size="sm" variant="outline">
                            <a href={product.avitoListingUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                              <Link2 className="h-4 w-4" />
                              <span className="hidden sm:inline">Объявление</span>
                            </a>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Без ссылки</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {viewingNote.attachments.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Файлы</h3>
                  <div className="space-y-2">
                    {viewingNote.attachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        href={attachment.url}
                        className="flex min-h-12 items-center gap-3 rounded-md bg-secondary/55 px-3 py-2 transition-colors hover:bg-secondary"
                      >
                        <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.name}</span>
                        <span className="text-xs text-muted-foreground">{formatFileSize(attachment.size)}</span>
                        <Download className="h-4 w-4 text-muted-foreground" />
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              {viewingNote.mentions.length > 0 ? (
                <div className="flex items-start gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-foreground">
                  <AtSign className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    Отмечены: {viewingNote.mentions.map(({ user }) => user.name).join(", ")}
                  </span>
                </div>
              ) : null}

              <div className="flex items-center gap-2 rounded-md bg-secondary/45 px-3 py-2 text-xs text-muted-foreground">
                {viewingNote.visibility === "ALL" ? <Globe2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                {viewingNote.visibility === "ALL"
                  ? "Заметка видна всем сотрудникам"
                  : `Видят: ${viewingNote.viewers.map(({ user }) => user.name).join(", ")}`}
              </div>
            </div>
            {viewingNote.createdBy.id === currentUserId ? (
              <div className="flex justify-end gap-2 border-t px-5 py-4">
                <Button variant="ghost" onClick={() => deleteNote(viewingNote)} disabled={saving}>
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </Button>
                <Button variant="outline" onClick={() => openEdit(viewingNote)}>
                  <Pencil className="h-4 w-4" />
                  Редактировать
                </Button>
              </div>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function ProductThumb({ product }: { product: Product }) {
  return product.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={product.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover bg-muted" />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
      <PackageSearch className="h-4 w-4" />
    </span>
  );
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat("ru-RU", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short" }).format(date);
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function plural(value: number, one: string, few: string, many: string) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderNoteContent(content: string) {
  return content.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-primary underline decoration-primary/35 underline-offset-2 hover:decoration-primary"
      >
        {part}
      </a>
    ) : part,
  );
}
