"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type AvitoServiceProfile = {
  id: string;
  name: string;
  accountId: string | null;
  reportEmail: string | null;
  isActive: boolean;
  hasCredentials: boolean;
};

export function AvitoProfileSelect({
  profiles,
  value,
  onValueChange,
  id,
  disabled,
  className,
}: {
  profiles: AvitoServiceProfile[];
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled || profiles.length === 0}>
      <SelectTrigger id={id} className={cn("min-w-0", className)}>
        <SelectValue placeholder={profiles.length ? "Выберите профиль" : "Нет активных профилей"} />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  profile.hasCredentials ? "bg-success" : "bg-warning",
                )}
              />
              <span className="min-w-0 truncate">{profile.name}</span>
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                {profile.hasCredentials ? profile.accountId || "API подключён" : "нужны API-ключи"}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
