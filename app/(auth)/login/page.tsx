"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, X } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"detecting" | "telegram-loading" | "form" | "denied">("detecting");

  useEffect(() => {
    const tg = (window as { Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } } }).Telegram?.WebApp;
    if (tg?.initData) {
      tg.ready?.();
      tg.expand?.();
      setMode("telegram-loading");
      // Fetch the CSRF token explicitly for Telegram WebApp.
      const loadTelegramSession = async () => {
        const csrfRes = await fetch("/api/auth/csrf", { credentials: "same-origin" });
        const { csrfToken } = await csrfRes.json();

        const res = await signIn("telegram", {
          initData: tg.initData,
          redirect: false,
          callbackUrl: "/dashboard",
          csrfToken,
        });

        if (typeof res === "string") {
          window.location.href = res || "/dashboard";
          return;
        }

        if (res?.error) {
          throw new Error(res.error);
        }

        const sessionRes = await fetch("/api/auth/session", { credentials: "same-origin" });
        const session = await sessionRes.json();
        if (session?.user) {
          window.location.href = res?.url || "/dashboard";
          return;
        }

        throw new Error("No session after Telegram sign-in");
      };

      loadTelegramSession().catch(() => {
        setMode("denied");
      });
    } else {
      setMode("form");
    }
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: data.get("email"),
      password: data.get("password"),
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Неверный email или пароль");
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  if (mode === "detecting" || mode === "telegram-loading") {
    return (
      <div className="app-shell flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Вход через Telegram...</p>
        </div>
      </div>
    );
  }

  if (mode === "denied") {
    return (
      <div className="app-shell flex items-center justify-center p-4">
        <div className="max-w-xs rounded-lg border border-border/75 bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <X className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Доступ запрещён</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ваш аккаунт Telegram не привязан к системе. Обратитесь к администратору.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border/75 bg-card p-5 shadow-sm">
        <div className="mb-6 space-y-1">
          <p className="section-caption">Рабочий доступ</p>
          <h1 className="text-2xl font-semibold tracking-tight">CRM Avito</h1>
          <p className="text-sm text-muted-foreground">Войдите в систему учёта</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Вход..." : "Войти"}
          </Button>
        </form>
      </div>
    </div>
  );
}
