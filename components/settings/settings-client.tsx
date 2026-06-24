"use client";

import { ArrowLeft, LogOut, User, Shield, Palette } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

interface Props {
  user: { name: string; email: string; role: string };
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
};

export function SettingsClient({ user }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b px-4 pt-12 pb-3">
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
                <p className="text-sm text-muted-foreground">{user.email}</p>
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
              <span className={`text-sm font-medium px-2.5 py-1 rounded-full ${
                user.role === "ADMIN"
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-muted text-muted-foreground"
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

        {/* Sign out */}
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Выйти из системы
        </Button>
      </div>
    </div>
  );
}
