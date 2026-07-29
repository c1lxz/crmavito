import { OrderStatus, ReturnStatus, ExpenseCategory } from "@prisma/client";
import type { StatusBadgeTone } from "@/components/ui/status-badge";

export const ORDER_STATUS_TONES: Record<OrderStatus, { tone: StatusBadgeTone; pulse: boolean }> = {
  ACCEPTED: { tone: "violet", pulse: true },
  SHIPPED: { tone: "sky", pulse: true },
  RECEIVED: { tone: "emerald", pulse: false },
  RETURNING: { tone: "orange", pulse: true },
  RETURNED: { tone: "red", pulse: false },
  CANCELLED: { tone: "slate", pulse: false },
};

export const RETURN_STATUS_TONES: Record<ReturnStatus, { tone: StatusBadgeTone; pulse: boolean }> = {
  RETURNING: { tone: "orange", pulse: true },
  RETURNED: { tone: "red", pulse: false },
  CANCELLED: { tone: "slate", pulse: false },
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  ACCEPTED: "Принят",
  SHIPPED: "Отправлен",
  RECEIVED: "Получен",
  RETURNING: "На возврате",
  RETURNED: "Возврат",
  CANCELLED: "Отменён",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  ACCEPTED: "bg-special/15 text-special",
  SHIPPED: "bg-info/15 text-info",
  RECEIVED: "bg-success/15 text-success",
  RETURNING: "bg-warning/15 text-warning",
  RETURNED: "bg-destructive/15 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  RETURNING: "На возврате",
  RETURNED: "Возвращён",
  CANCELLED: "Отменён",
};

export const RETURN_STATUS_COLORS: Record<ReturnStatus, string> = {
  RETURNING: "bg-warning/15 text-warning",
  RETURNED: "bg-destructive/15 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  PURCHASE: "Закупка товара",
  ADVERTISING: "Реклама",
  LOGISTICS: "Логистика",
  SALARY: "Зарплаты",
  PACKAGING: "Упаковка",
  AVITO_COMMISSION: "Комиссии Avito",
  OTHER: "Прочие расходы",
};

export const EXPENSE_CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  PURCHASE: "hsl(var(--chart-5))",
  ADVERTISING: "hsl(var(--chart-3))",
  LOGISTICS: "hsl(var(--chart-1))",
  SALARY: "hsl(var(--special))",
  PACKAGING: "hsl(var(--chart-2))",
  AVITO_COMMISSION: "hsl(var(--chart-4))",
  OTHER: "hsl(var(--muted-foreground))",
};
