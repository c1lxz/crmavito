import { prisma } from "@/lib/db/prisma";
import { ExpensesClient } from "@/components/expenses/expenses-client";
import { toDecimalNumber } from "@/lib/db/orders";
import {
  endOfDatabaseDate,
  endOfMonth,
  startOfDatabaseDate,
  startOfMonth,
} from "@/lib/utils";

async function getExpenses() {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [expenses, monthExpenses] = await Promise.all([
    prisma.expense.findMany({
      include: { createdBy: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.expense.findMany({
      where: {
        date: {
          gte: startOfDatabaseDate(monthStart),
          lte: endOfDatabaseDate(monthEnd),
        },
      },
    }),
  ]);

  const byCategory = monthExpenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + toDecimalNumber(e.amount);
    return acc;
  }, {} as Record<string, number>);

  const total = monthExpenses.reduce((s, e) => s + toDecimalNumber(e.amount), 0);

  return {
    expenses: expenses.map((e) => ({
      ...e,
      amount: toDecimalNumber(e.amount),
      date: e.date.toISOString(),
      createdAt: e.createdAt.toISOString(),
    })),
    monthByCategory: byCategory,
    monthTotal: total,
  };
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const query = await searchParams;
  const data = await getExpenses();
  return <ExpensesClient initialData={data} initialOpen={query.new === "1"} />;
}
