import { formatDateInput } from "@/lib/utils";

export interface ExpenseSummaryItem {
  date: string | Date;
  category: string;
  amount: number;
}

export function summarizeExpensesForMonth(
  expenses: ExpenseSummaryItem[],
  now = new Date()
): { total: number; byCategory: Record<string, number> } {
  const monthKey = formatDateInput(now).slice(0, 7);
  const byCategory: Record<string, number> = {};
  let total = 0;

  for (const expense of expenses) {
    const dateKey = formatDateInput(
      typeof expense.date === "string" ? new Date(expense.date) : expense.date,
    ).slice(0, 7);
    if (dateKey !== monthKey) continue;
    const amount = Number(expense.amount);
    if (!Number.isFinite(amount)) continue;
    total += amount;
    byCategory[expense.category] = (byCategory[expense.category] ?? 0) + amount;
  }

  return { total, byCategory };
}
