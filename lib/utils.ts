import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRub(amount: number): string {
  return (
    new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount) + " ₽"
  );
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return (
    d.toLocaleDateString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) +
    " · " +
    d.toLocaleTimeString("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
    })
  );
}

export function formatDateInput(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function parseMoscowDateInput(value: string, end = false): Date {
  const time = end ? "23:59:59.999" : "00:00:00.000";
  return new Date(`${value}T${time}+03:00`);
}

export function parseDatabaseDateInput(value: string, end = false): Date {
  const time = end ? "23:59:59.999" : "00:00:00.000";
  return new Date(`${value}T${time}Z`);
}

export function startOfDatabaseDate(date: Date): Date {
  return parseDatabaseDateInput(formatDateInput(date));
}

export function endOfDatabaseDate(date: Date): Date {
  return parseDatabaseDateInput(formatDateInput(date), true);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value) + "%";
}

export function startOfDay(d: Date): Date {
  return parseMoscowDateInput(formatDateInput(d));
}

export function endOfDay(d: Date): Date {
  return parseMoscowDateInput(formatDateInput(d), true);
}

export function normalizeSearch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchesSearch(haystack: string, needle: string): boolean {
  const n = normalizeSearch(needle);
  if (!n) return true;
  const h = normalizeSearch(haystack);
  return n.split(" ").every((token) => h.includes(token));
}

export function subDays(d: Date, days: number): Date {
  return new Date(d.getTime() - days * 24 * 60 * 60 * 1000);
}

export function startOfMonth(d: Date): Date {
  return parseMoscowDateInput(`${formatDateInput(d).slice(0, 7)}-01`);
}

export function endOfMonth(d: Date): Date {
  const [year, month] = formatDateInput(d).split("-").map(Number);
  const nextMonth = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return new Date(parseMoscowDateInput(nextMonth).getTime() - 1);
}
