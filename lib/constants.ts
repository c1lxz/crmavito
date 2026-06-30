import { OrderStatus, ReturnStatus, ExpenseCategory } from "@prisma/client";
import type { StatusBadgeTone } from "@/components/ui/status-badge";

export const ORDER_STATUS_TONES: Record<OrderStatus, { tone: StatusBadgeTone; pulse: boolean }> = {
  ACCEPTED: { tone: "violet", pulse: true },
  SHIPPED: { tone: "sky", pulse: true },
  RECEIVED: { tone: "emerald", pulse: false },
  RETURNING: { tone: "orange", pulse: true },
  RETURNED: { tone: "red", pulse: false },
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
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  ACCEPTED: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  SHIPPED: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  RECEIVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  RETURNING: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  RETURNED: "bg-red-500/15 text-red-700 dark:text-red-300",
};

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  RETURNING: "На возврате",
  RETURNED: "Возвращён",
  CANCELLED: "Отменён",
};

export const RETURN_STATUS_COLORS: Record<ReturnStatus, string> = {
  RETURNING: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  RETURNED: "bg-red-500/15 text-red-700 dark:text-red-300",
  CANCELLED: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
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
  PURCHASE: "#6D5BD0",
  ADVERTISING: "#f59e0b",
  LOGISTICS: "#3b82f6",
  SALARY: "#7C3AED",
  PACKAGING: "#14b8a6",
  AVITO_COMMISSION: "#ef4444",
  OTHER: "#6b7280",
};
