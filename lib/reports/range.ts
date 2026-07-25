import { endOfDay, formatDateInput, parseMoscowDateInput, startOfDay, subDays } from "@/lib/utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export type ReportDateRange = { from: Date; to: Date };

export function buildRecentReportRange(
  periodDays: number,
  now = new Date(),
): { dateFrom: string; dateTo: string } {
  const days = Math.max(1, Math.round(Number.isFinite(periodDays) ? periodDays : 30));
  return {
    dateFrom: formatDateInput(subDays(now, days - 1)),
    dateTo: formatDateInput(now),
  };
}

export function getPreviousReportRange(range: ReportDateRange): ReportDateRange {
  const periodDays = Math.floor((range.to.getTime() - range.from.getTime()) / DAY_MS) + 1;
  return {
    from: subDays(range.from, periodDays),
    to: subDays(range.to, periodDays),
  };
}

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
): ReportDateRange {
  const from = dateFrom ? parseDate(dateFrom, false) : startOfDay(subDays(now, 29));
  const to = dateTo ? parseDate(dateTo, true) : endOfDay(now);
  if (from > to) throw new Error("Начальная дата не может быть позже конечной");
  return { from, to };
}
