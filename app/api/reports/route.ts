import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getKpiForRange, getPnL, getProductsReport, getCounterpartiesReport, getReturnsReport, getDynamicsChart, getOrderStatusCounts, getExpenseCategoryTotals, getAvitoProfileCounts, getMarketplaceReport } from "@/lib/db/reports";
import type { Marketplace } from "@prisma/client";
import { getPreviousReportRange, parseReportRange } from "@/lib/reports/range";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "kpi";
  const marketplaceParam = searchParams.get("marketplace");
  const marketplace: Marketplace | undefined =
    marketplaceParam === "AVITO" || marketplaceParam === "WB" ? marketplaceParam : undefined;
  if (marketplaceParam && !marketplace) {
    return NextResponse.json({ error: "Некорректная площадка" }, { status: 400 });
  }
  let range: ReturnType<typeof parseReportRange>;
  try {
    range = parseReportRange(searchParams.get("dateFrom"), searchParams.get("dateTo"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Некорректный период" },
      { status: 400 },
    );
  }
  switch (type) {
    case "kpi": {
      const [current, prev] = await Promise.all([
        getKpiForRange(range, undefined, marketplace),
        getKpiForRange(getPreviousReportRange(range), undefined, marketplace),
      ]);
      return NextResponse.json({ current, prev });
    }
    case "pnl":
      return NextResponse.json(await getPnL(range, marketplace));
    case "products":
      return NextResponse.json(await getProductsReport(range, marketplace));
    case "counterparties":
      return NextResponse.json(await getCounterpartiesReport(range, marketplace));
    case "returns":
      return NextResponse.json(await getReturnsReport(range, marketplace));
    case "dynamics":
      return NextResponse.json(await getDynamicsChart(range, marketplace));
    case "order-statuses":
      return NextResponse.json(await getOrderStatusCounts(range, marketplace));
    case "expense-categories":
      return NextResponse.json(await getExpenseCategoryTotals(range));
    case "avito-profiles":
      return NextResponse.json(await getAvitoProfileCounts(range, marketplace));
    case "marketplaces":
      return NextResponse.json(await getMarketplaceReport(range));
    default:
      return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
  }
}
