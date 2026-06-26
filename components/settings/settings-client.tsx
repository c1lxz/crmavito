"use client";

import { useState } from "react";
import { ArrowLeft, LogOut, User, Shield, Palette, Users, Plus, ToggleLeft, ToggleRight } from "lucide-react";
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
  telegramId: string | null;
  role: "ADMIN" | "MANAGER";
  isActive: boolean;
}

interface Props {
  user: { id: string; name: string; email: string; role: string };
  users: UserItem[];
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
};

export function SettingsClient({ user, users: initialUsers }: Props) {
  const [users, setUsers] = useState<UserItem[]>(initialUsers);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", telegramId: "", role: "MANAGER" });
  const [addLoading, setAddLoading] = useState(false);

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
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setUsers((u) => [...u, data]);
      setShowAddDialog(false);
      setAddForm({ name: "", telegramId: "", role: "MANAGER" });
      toast({ title: "Пользователь добавлен" });
    } catch (err) {
      toast({ title: "Ошибка", description: String(err), variant: "destructive" });
    } finally {
      setAddLoading(false);
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
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b px-4 pt-[var(--app-top-pad)] pb-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-bold text-lg">Настройки</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Profile */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <User className="h-4 w-4" /> Профиль
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold flex-shrink-0">
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
                  ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary"
                  : "bg-muted text-foreground/65"
              }`}>
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>
            {user.role === "ADMIN" && (
              <Link
                href="/audit-log"
                className="mt-3 flex items-center justify-between text-sm text-primary hover:text-primary/80 transition-colors"
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
                <div key={u.id} className={`flex items-center gap-3 p-2 rounded-lg ${!u.isActive ? "opacity-50" : ""}`}>
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.telegramId ? `TG: ${u.telegramId}` : "—"}
                    </p>
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
                    <button onClick={() => toggleActive(u.id, u.isActive)} className="text-muted-foreground hover:text-foreground transition-colors">
                      {u.isActive
                        ? <ToggleRight className="h-5 w-5 text-primary" />
                        : <ToggleLeft className="h-5 w-5" />
                      }
                    </button>
                  )}
                </div>
              ))}
              {users.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">Нет пользователей</p>
              )}
            </CardContent>
          </Card>
        )}

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
              <Label>Telegram ID</Label>
              <Input
                placeholder="например: 1247326625"
                value={addForm.telegramId}
                onChange={(e) => setAddForm((f) => ({ ...f, telegramId: e.target.value }))}
                required
              />
              <p className="text-xs text-muted-foreground">Узнать ID: написать @userinfobot в Telegram</p>
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
    </div>
  );
}
