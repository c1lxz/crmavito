export interface ExpenseSummaryItem {
  date: string | Date;
  category: string;
  amount: number;
}

export function summarizeExpensesForMonth(
  expenses: ExpenseSummaryItem[],
  now = new Date()
): { total: number; byCategory: Record<string, number> } {
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const byCategory: Record<string, number> = {};
  let total = 0;

  for (const expense of expenses) {
    const dateKey =
      typeof expense.date === "string"
        ? expense.date.slice(0, 7)
        : `${expense.date.getFullYear()}-${String(expense.date.getMonth() + 1).padStart(2, "0")}`;
    if (dateKey !== monthKey) continue;
    const amount = Number(expense.amount);
    if (!Number.isFinite(amount)) continue;
    total += amount;
    byCategory[expense.category] = (byCategory[expense.category] ?? 0) + amount;
  }

  return { total, byCategory };
}
