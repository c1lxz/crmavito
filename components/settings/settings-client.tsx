"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, Database, FileArchive, KeyRound, LogOut, PackageCheck, Palette, Plus, Save, Shield, Store, ToggleLeft, ToggleRight, Trash2, User, Users } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/hooks/use-toast";

interface UserItem {
  id: string;
  name: string;
  login: string | null;
  telegramId: string | null;
  credentialsDeliveredAt: string | Date | null;
  credentialsDeliveryError: string | null;
  role: "ADMIN" | "MANAGER";
  isActive: boolean;
}

interface IssuedCredentials {
  credentials: { login: string; password: string };
  delivery: { sent: boolean; error: string | null };
}

interface AvitoProfile {
  id: string;
  name: string;
  color: string | null;
  accountId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  reportEmail: string | null;
  isActive: boolean;
}

interface Props {
  user: { id: string; name: string; email: string; role: string; isOwner: boolean };
  users: UserItem[];
  avitoProfiles: AvitoProfile[];
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
};

export function SettingsClient({ user, users: initialUsers, avitoProfiles: initialAvitoProfiles }: Props) {
  const [users, setUsers] = useState<UserItem[]>(initialUsers);
  const [avitoProfiles, setAvitoProfiles] = useState<AvitoProfile[]>(initialAvitoProfiles);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAvitoProfileDialog, setShowAvitoProfileDialog] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", telegramId: "", role: "MANAGER" });
  const [avitoProfileName, setAvitoProfileName] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [avitoProfileLoading, setAvitoProfileLoading] = useState(false);
  const [savingAvitoProfileId, setSavingAvitoProfileId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [issuedCredentials, setIssuedCredentials] = useState<IssuedCredentials | null>(null);
  const [issuingUserId, setIssuingUserId] = useState<string | null>(null);

  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  useEffect(() => {
    setAvitoProfiles(initialAvitoProfiles);
  }, [initialAvitoProfiles]);

  async function handleAddAvitoProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!avitoProfileName.trim()) return;
    setAvitoProfileLoading(true);
    try {
      const res = await fetch("/api/avito-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: avitoProfileName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Ошибка");
      setAvitoProfiles((items) => [...items, data]);
      setAvitoProfileName("");
      setShowAvitoProfileDialog(false);
      toast({ title: "Профиль Avito создан" });
    } catch (error) {
      toast({ title: "Ошибка", description: String(error), variant: "destructive" });
    } finally {
      setAvitoProfileLoading(false);
    }
  }

  async function toggleAvitoProfile(profile: AvitoProfile) {
    try {
      const response = await fetch(`/api/avito-profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !profile.isActive }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Ошибка");
      setAvitoProfiles((items) => items.map((item) => (item.id === profile.id ? data : item)));
    } catch (error) {
      toast({ title: "Ошибка обновления", description: String(error), variant: "destructive" });
    }
  }

  function patchAvitoProfile(id: string, patch: Partial<AvitoProfile>) {
    setAvitoProfiles((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function saveAvitoProfile(profile: AvitoProfile) {
    setSavingAvitoProfileId(profile.id);
    try {
      const response = await fetch(`/api/avito-profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          clientId: profile.clientId?.trim() || null,
          clientSecret: profile.clientSecret?.trim() || null,
          reportEmail: profile.reportEmail?.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Ошибка");
      setAvitoProfiles((items) => items.map((item) => (item.id === profile.id ? data : item)));
      toast({ title: "Профиль Avito сохранён" });
    } catch (error) {
      toast({ title: "Ошибка сохранения", description: String(error), variant: "destructive" });
    } finally {
      setSavingAvitoProfileId(null);
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = typeof data.error === "string" ? data.error : "Ошибка";
        throw new Error(message);
      }
      setUsers((u) => [...u, data.user]);
      setShowAddDialog(false);
      setAddForm({ name: "", telegramId: "", role: "MANAGER" });
      setIssuedCredentials({ credentials: data.credentials, delivery: data.delivery });
      toast({
        title: "Пользователь добавлен",
        description: data.delivery.sent
          ? "Логин и пароль отправлены в Telegram."
          : "Telegram не принял сообщение — сохраните реквизиты из окна.",
      });
    } catch (err) {
      toast({ title: "Ошибка", description: String(err), variant: "destructive" });
    } finally {
      setAddLoading(false);
    }
  }

  async function issueCredentials(target: UserItem) {
    setIssuingUserId(target.id);
    try {
      const response = await fetch(`/api/users/${target.id}/credentials`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Ошибка");
      }
      setIssuedCredentials(data);
      setUsers((current) =>
        current.map((item) =>
          item.id === target.id
            ? {
                ...item,
                login: data.credentials.login,
                credentialsDeliveredAt: data.delivery.sent ? new Date().toISOString() : null,
                credentialsDeliveryError: data.delivery.error,
              }
            : item,
        ),
      );
    } catch (error) {
      toast({ title: "Не удалось выдать доступ", description: String(error), variant: "destructive" });
    } finally {
      setIssuingUserId(null);
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (!res.ok) throw new Error("Ошибка");
      setUsers((u) => u.map((x) => x.id === id ? { ...x, isActive: !isActive } : x));
    } catch {
      toast({ title: "Ошибка обновления", variant: "destructive" });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data?.error === "string" ? data.error : "Ошибка удаления";
        throw new Error(message);
      }
      if (data?.mode === "soft") {
        setUsers((u) => u.map((x) => (x.id === deleteTarget.id ? { ...x, isActive: false } : x)));
        toast({ title: "Сотрудник деактивирован", description: "У него есть связанная история — аккаунт сохранён как неактивный." });
      } else {
        setUsers((u) => u.filter((x) => x.id !== deleteTarget.id));
        toast({ title: "Сотрудник удалён" });
      }
      setDeleteTarget(null);
    } catch (err) {
      toast({ title: "Ошибка", description: String(err), variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  }

  async function changeRole(id: string, role: string) {
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error("Ошибка");
      setUsers((u) => u.map((x) => x.id === id ? { ...x, role: role as "ADMIN" | "MANAGER" } : x));
    } catch {
      toast({ title: "Ошибка обновления", variant: "destructive" });
    }
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="icon-tile h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Настройки</h1>
            <p className="section-caption">Доступ, пользователи и тема</p>
          </div>
        </div>
      </div>

      <div className="app-content space-y-4">
        {/* Profile */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <User className="h-4 w-4" /> Профиль
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-md bg-sidebar flex items-center justify-center text-sidebar-foreground text-xl font-bold flex-shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-base">{user.name}</p>
                <p className="text-sm text-muted-foreground">{user.email || "Telegram"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Role */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" /> Роль и доступ
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Роль</span>
              <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${
                user.role === "ADMIN"
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-foreground/65"
              }`}>
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>
            {user.role === "ADMIN" && (
              <Link
                href="/audit-log"
                className="mt-3 flex items-center justify-between text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
              >
                <span>Журнал аудита</span>
                <ArrowLeft className="h-4 w-4 rotate-180" />
              </Link>
            )}
          </CardContent>
        </Card>

        {/* User management — admins only */}
        {user.role === "ADMIN" && (
          <Card>
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" /> Пользователи
                </CardTitle>
                <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Добавить
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {users.map((u) => (
                <div key={u.id} className={`flex items-center gap-3 p-2 rounded-md hover:bg-secondary/70 ${!u.isActive ? "opacity-50" : ""}`}>
                  <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.login ? `Логин: ${u.login}` : "Логин не создан"}
                    </p>
                    {u.credentialsDeliveryError ? (
                      <p className="truncate text-[11px] font-medium text-destructive">
                        Telegram: не доставлено
                      </p>
                    ) : u.credentialsDeliveredAt ? (
                      <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                        Доступ отправлен
                      </p>
                    ) : null}
                  </div>
                  <Select
                    value={u.role}
                    onValueChange={(v) => u.id !== user.id && changeRole(u.id, v)}
                    disabled={u.id === user.id}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ADMIN">Администратор</SelectItem>
                      <SelectItem value="MANAGER">Менеджер</SelectItem>
                    </SelectContent>
                  </Select>
                  {u.id !== user.id && (
                    <>
                      <button
                        onClick={() => issueCredentials(u)}
                        disabled={issuingUserId === u.id}
                        className="text-muted-foreground transition-colors hover:text-primary disabled:opacity-45"
                        aria-label={u.login ? "Выдать новый пароль" : "Создать логин и пароль"}
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => toggleActive(u.id, u.isActive)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={u.isActive ? "Деактивировать" : "Активировать"}
                      >
                        {u.isActive
                          ? <ToggleRight className="h-5 w-5 text-primary" />
                          : <ToggleLeft className="h-5 w-5" />
                        }
                      </button>
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {users.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">Нет пользователей</p>
              )}
            </CardContent>
          </Card>
        )}

        {user.role === "ADMIN" && (
          <Card>
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Профили Avito
                </CardTitle>
                {user.isOwner && (
                  <Button size="sm" variant="outline" onClick={() => setShowAvitoProfileDialog(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Добавить
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {avitoProfiles.map((profile) => (
                <div key={profile.id} className={`rounded-md p-2 hover:bg-secondary/70 ${!profile.isActive ? "opacity-50" : ""}`}>
                  <div className="mb-2 flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-bold">
                      {profile.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      {user.isOwner ? (
                        <Input
                          className="h-8"
                          value={profile.name}
                          onChange={(event) => patchAvitoProfile(profile.id, { name: event.target.value })}
                        />
                      ) : (
                        <p className="truncate text-sm font-medium">{profile.name}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">{profile.isActive ? "Активен" : "Отключен"}</p>
                    </div>
                    {user.isOwner && (
                      <>
                        <button
                          onClick={() => toggleAvitoProfile(profile)}
                          className="text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={profile.isActive ? "Отключить профиль" : "Включить профиль"}
                        >
                          {profile.isActive ? <ToggleRight className="h-5 w-5 text-primary" /> : <ToggleLeft className="h-5 w-5" />}
                        </button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          onClick={() => saveAvitoProfile(profile)}
                          disabled={savingAvitoProfileId === profile.id || !profile.name.trim()}
                          aria-label="Сохранить профиль Avito"
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  {user.isOwner && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input
                      placeholder="client_id"
                      value={profile.clientId ?? ""}
                      onChange={(event) => patchAvitoProfile(profile.id, { clientId: event.target.value })}
                      autoComplete="off"
                    />
                    <Input
                      type="password"
                      placeholder="client_secret"
                      value={profile.clientSecret ?? ""}
                      onChange={(event) => patchAvitoProfile(profile.id, { clientSecret: event.target.value })}
                      autoComplete="off"
                    />
                    <Input
                      type="email"
                      placeholder="Email отчётов"
                      value={profile.reportEmail ?? ""}
                      onChange={(event) => patchAvitoProfile(profile.id, { reportEmail: event.target.value })}
                      autoComplete="email"
                    />
                  </div>
                  )}
                  {profile.accountId && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">Account ID: {profile.accountId}</p>
                  )}
                </div>
              ))}
              {avitoProfiles.length === 0 && (
                <p className="py-2 text-center text-sm text-muted-foreground">Профилей Avito пока нет</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* References / dictionaries */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4" /> Справочники
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1">
            <Link
              href="/counterparties"
              className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-secondary/70 transition-colors"
            >
              <span>Контрагенты (поставщики)</span>
              <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
            </Link>
            <Link
              href="/products"
              className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-secondary/70 transition-colors"
            >
              <span>Товары (синхронизация с Avito)</span>
              <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
            </Link>
            <Link
              href="/v"
              className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-secondary/70 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileArchive className="h-4 w-4 text-muted-foreground" />
                Выгрузка объявлений XML
              </span>
              <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
            </Link>
            <Link
              href="/wbr"
              className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-secondary/70 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Store className="h-4 w-4 text-muted-foreground" />
                WB Resale
              </span>
              <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
            </Link>
            {user.role === "ADMIN" && (
              <>
              <Link
                href="/settings/stocks"
                className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-secondary/70 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-muted-foreground" />
                  Остатки Avito
                </span>
                <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
              </Link>
              <Link
                href="/settings/market-analysis"
                className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-secondary/70 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  Аналитика объявлений
                </span>
                <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
              </Link>
              </>
            )}
          </CardContent>
        </Card>

        {/* Theme */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Palette className="h-4 w-4" /> Тема оформления
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ThemeToggle variant="buttons" />
          </CardContent>
        </Card>

        <Button
          variant="destructive"
          className="w-full"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Выйти из системы
        </Button>
      </div>

      {/* Delete user confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleteLoading && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить сотрудника?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget?.name}. Если у сотрудника есть связанные заказы, расходы или записи в журнале — он будет деактивирован, а не удалён, чтобы не сломать историю.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>
              Отмена
            </Button>
            <Button variant="destructive" className="flex-1" onClick={confirmDelete} disabled={deleteLoading}>
              {deleteLoading ? "Удаление..." : "Удалить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAvitoProfileDialog} onOpenChange={(open) => !open && setShowAvitoProfileDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Новый профиль Avito</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddAvitoProfile} className="space-y-4">
            <div className="space-y-1">
              <Label>Название</Label>
              <Input
                placeholder="Название профиля"
                value={avitoProfileName}
                onChange={(event) => setAvitoProfileName(event.target.value)}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowAvitoProfileDialog(false)}>
                Отмена
              </Button>
              <Button type="submit" className="flex-1" disabled={avitoProfileLoading || !avitoProfileName.trim()}>
                {avitoProfileLoading ? "Создание..." : "Создать"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add user dialog */}
      <Dialog open={showAddDialog} onOpenChange={(o) => !o && setShowAddDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Добавить пользователя</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddUser} className="space-y-4">
            <div className="space-y-1">
              <Label>Имя</Label>
              <Input
                placeholder="Имя пользователя"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Telegram ID или @username</Label>
              <Input
                placeholder="1247326625 или @username"
                value={addForm.telegramId}
                onChange={(e) => setAddForm((f) => ({ ...f, telegramId: e.target.value }))}
                required
              />
              <p className="text-xs text-muted-foreground">
                Система создаст браузерный логин и пароль. Telegram не позволяет боту
                написать первым: сотрудник должен хотя бы один раз открыть бота.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Роль</Label>
              <Select value={addForm.role} onValueChange={(v) => setAddForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANAGER">Менеджер</SelectItem>
                  <SelectItem value="ADMIN">Администратор</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowAddDialog(false)}>
                Отмена
              </Button>
              <Button type="submit" className="flex-1" disabled={addLoading}>
                {addLoading ? "Добавление..." : "Добавить"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!issuedCredentials}
        onOpenChange={(open) => !open && setIssuedCredentials(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Доступ сотрудника</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Пароль показывается только сейчас. Сохраните его до закрытия окна.
          </p>
          <div className="mt-4 space-y-3">
            <div className="space-y-1">
              <Label>Логин</Label>
              <Input readOnly value={issuedCredentials?.credentials.login ?? ""} />
            </div>
            <div className="space-y-1">
              <Label>Пароль</Label>
              <Input readOnly value={issuedCredentials?.credentials.password ?? ""} />
            </div>
            <div
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                issuedCredentials?.delivery.sent
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
            >
              {issuedCredentials?.delivery.sent ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>
                {issuedCredentials?.delivery.sent
                  ? "Реквизиты отправлены сотруднику в Telegram."
                  : `Не удалось отправить в Telegram: ${
                      issuedCredentials?.delivery.error ?? "неизвестная ошибка"
                    }`}
              </span>
            </div>
          </div>
          <Button className="mt-4 w-full" onClick={() => setIssuedCredentials(null)}>
            Я сохранил реквизиты
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
