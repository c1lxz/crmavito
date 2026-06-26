import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CounterpartiesClient } from "@/components/counterparties/counterparties-client";
import { calcOrderFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "@/lib/db/orders";

async function getCounterpartiesWithStats() {
  const counterparties = await prisma.counterparty.findMany({
    orderBy: { name: "asc" },
    include: {
      orders: {
        where: { isDeleted: false },
        select: {
          status: true,
          salePriceAtOrder: true,
          purchasePricePerUnit: true,
          logisticsCost: true,
          commissionCost: true,
          otherCosts: true,
          quantity: true,
        },
      },
    },
  });

  type CPOrder = (typeof counterparties)[number]["orders"][number];
  type Counterparty = (typeof counterparties)[number];
  return counterparties.map((cp: Counterparty) => {
    const receivedOrders = cp.orders.filter((o: CPOrder) => o.status === "RECEIVED");
    let totalRevenue = 0;
    let totalProfit = 0;
    let totalPurchase = 0;

    for (const o of cp.orders) {
      totalPurchase += toDecimalNumber(o.purchasePricePerUnit) * o.quantity;
    }
    for (const o of receivedOrders) {
      const fin = calcOrderFinancials({
        salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
        quantity: o.quantity,
        purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
        logisticsCost: toDecimalNumber(o.logisticsCost),
        commissionCost: toDecimalNumber(o.commissionCost),
        otherCosts: toDecimalNumber(o.otherCosts),
      });
      totalRevenue += fin.revenue;
      totalProfit += fin.netProfit;
    }

    return {
      id: cp.id,
      name: cp.name,
      contactInfo: cp.contactInfo,
      comment: cp.comment,
      createdAt: cp.createdAt.toISOString(),
      ordersCount: cp.orders.length,
      totalPurchase,
      totalRevenue,
      totalProfit,
    };
  });
}

export default async function CounterpartiesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const counterparties = await getCounterpartiesWithStats();
  return <CounterpartiesClient counterparties={counterparties} />;
}
