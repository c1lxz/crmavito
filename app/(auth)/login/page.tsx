"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

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
      signIn("telegram", { initData: tg.initData, redirect: false }).then((res) => {
        if (res?.error) {
          setMode("denied");
        } else {
          router.push("/dashboard");
        }
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Вход через Telegram...</p>
        </div>
      </div>
    );
  }

  if (mode === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-xs">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-destructive/10 text-destructive text-xl mb-2">
            ✕
          </div>
          <h1 className="text-xl font-bold">Доступ запрещён</h1>
          <p className="text-muted-foreground text-sm">
            Ваш аккаунт Telegram не привязан к системе. Обратитесь к администратору.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary text-primary-foreground text-xl font-bold mb-2">
            A
          </div>
          <h1 className="text-2xl font-bold">CRM Avito</h1>
          <p className="text-muted-foreground text-sm">Войдите в систему</p>
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
