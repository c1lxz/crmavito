import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getKpiForRange, getPnL, getProductsReport, getCounterpartiesReport, getReturnsReport, getDynamicsChart, getOrderStatusCounts, getExpenseCategoryTotals, getAvitoProfileCounts } from "@/lib/db/reports";
import { subDays } from "@/lib/utils";
import { parseReportRange } from "@/lib/reports/range";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "kpi";
  let range: ReturnType<typeof parseReportRange>;
  try {
    range = parseReportRange(searchParams.get("dateFrom"), searchParams.get("dateTo"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Некорректный период" },
      { status: 400 },
    );
  }
  const { from: dateFrom, to: dateTo } = range;

  switch (type) {
    case "kpi": {
      const [current, prev] = await Promise.all([
        getKpiForRange(range),
        getKpiForRange({ from: subDays(dateFrom, Math.ceil((dateTo.getTime() - dateFrom.getTime()) / 86400000)), to: subDays(dateTo, Math.ceil((dateTo.getTime() - dateFrom.getTime()) / 86400000)) }),
      ]);
      return NextResponse.json({ current, prev });
    }
    case "pnl":
      return NextResponse.json(await getPnL(range));
    case "products":
      return NextResponse.json(await getProductsReport(range));
    case "counterparties":
      return NextResponse.json(await getCounterpartiesReport(range));
    case "returns":
      return NextResponse.json(await getReturnsReport(range));
    case "dynamics":
      return NextResponse.json(await getDynamicsChart(range));
    case "order-statuses":
      return NextResponse.json(await getOrderStatusCounts(range));
    case "expense-categories":
      return NextResponse.json(await getExpenseCategoryTotals(range));
    case "avito-profiles":
      return NextResponse.json(await getAvitoProfileCounts(range));
    default:
      return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
  }
}
