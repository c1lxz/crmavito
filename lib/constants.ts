import { OrderStatus, ReturnStatus, ExpenseCategory } from "@prisma/client";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  ACCEPTED: "Принят",
  SHIPPED: "Отправлен",
  RECEIVED: "Получен",
  RETURNING: "На возврате",
  RETURNED: "Возвращён",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  ACCEPTED: "bg-blue-100 text-blue-700",
  SHIPPED: "bg-yellow-100 text-yellow-700",
  RECEIVED: "bg-green-100 text-green-700",
  RETURNING: "bg-orange-100 text-orange-700",
  RETURNED: "bg-red-100 text-red-700",
};

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  RETURNING: "На возврате",
  RETURNED: "Возвращён",
  CANCELLED: "Отменён",
};

export const RETURN_STATUS_COLORS: Record<ReturnStatus, string> = {
  RETURNING: "bg-orange-100 text-orange-700",
  RETURNED: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-600",
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
  PURCHASE: "#6366f1",
  ADVERTISING: "#f59e0b",
  LOGISTICS: "#3b82f6",
  SALARY: "#8b5cf6",
  PACKAGING: "#14b8a6",
  AVITO_COMMISSION: "#ef4444",
  OTHER: "#6b7280",
};
