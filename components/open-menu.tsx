import Link from "next/link";
import { Monitor, Smartphone, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const actions = [
  {
    href: "/m/dashboard",
    title: "Мобильная CRM",
    description: "Для телефона и Telegram WebApp.",
    icon: Smartphone,
    primary: true,
  },
  {
    href: "/pc/dashboard",
    title: "CRM для ПК",
    description: "Для компьютера и широкого экрана.",
    icon: Monitor,
    primary: false,
  },
  {
    href: "/v",
    title: "XML-сервис",
    description: "Выгрузка объявлений Avito.",
    icon: UploadCloud,
    primary: false,
  },
];

export function OpenMenu() {
  return (
    <main className="min-h-screen bg-background px-4 py-[max(24px,env(safe-area-inset-top))] text-foreground">
      <div className="fixed right-4 top-[max(16px,env(safe-area-inset-top))] z-10">
        <ThemeToggle />
      </div>
      <div className="mx-auto flex min-h-[calc(100svh-48px)] w-full max-w-md flex-col justify-center gap-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-primary">CRM STROK SHOP</p>
          <h1 className="text-2xl font-semibold tracking-tight">Выберите, что открыть</h1>
          <p className="text-sm text-muted-foreground">
            Эта страница подходит для кнопки бота: один адрес, дальше выбор нужной версии.
          </p>
        </div>

        <div className="space-y-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.href}
                asChild
                variant={action.primary ? "default" : "outline"}
                className="h-auto w-full justify-start gap-3 px-4 py-3 text-left"
              >
                <Link href={action.href}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background/80 text-foreground">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{action.title}</span>
                    <span className="mt-0.5 block text-xs font-medium opacity-75">
                      {action.description}
                    </span>
                  </span>
                </Link>
              </Button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
