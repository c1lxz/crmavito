import { endOfDay, parseMoscowDateInput, startOfDay, subDays } from "@/lib/utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDate(value: string, end: boolean): Date {
  if (!DATE_RE.test(value)) throw new Error("Некорректный формат даты");
  const date = parseMoscowDateInput(value, end);
  if (Number.isNaN(date.getTime())) throw new Error("Некорректная дата");
  const roundTrip = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  if (roundTrip !== value) throw new Error("Некорректная дата");
  return date;
}

export function parseReportRange(
  dateFrom: string | null,
  dateTo: string | null,
  now = new Date(),
): { from: Date; to: Date } {
  const from = dateFrom ? parseDate(dateFrom, false) : startOfDay(subDays(now, 29));
  const to = dateTo ? parseDate(dateTo, true) : endOfDay(now);
  if (from > to) throw new Error("Начальная дата не может быть позже конечной");
  return { from, to };
}
