export interface OrderFinancials {
  salePriceAtOrder: number;
  quantity: number;
  purchasePricePerUnit: number;
  logisticsCost: number;
  commissionCost: number;
  otherCosts: number;
}

export interface CalculatedFinancials {
  revenue: number;
  costOfGoods: number;
  grossProfit: number;
  marginPercent: number;
  netProfit: number;
}

export function calcOrderFinancials(order: OrderFinancials): CalculatedFinancials {
  const revenue = order.salePriceAtOrder * order.quantity;
  const costOfGoods = order.purchasePricePerUnit * order.quantity;
  const grossProfit = revenue - costOfGoods;
  const marginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netProfit =
    revenue - costOfGoods - order.logisticsCost - order.commissionCost - order.otherCosts;

  return {
    revenue: round2(revenue),
    costOfGoods: round2(costOfGoods),
    grossProfit: round2(grossProfit),
    marginPercent: round2(marginPercent),
    netProfit: round2(netProfit),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sumFinancials(items: CalculatedFinancials[]): CalculatedFinancials {
  const revenue = items.reduce((s, i) => s + i.revenue, 0);
  const costOfGoods = items.reduce((s, i) => s + i.costOfGoods, 0);
  const grossProfit = items.reduce((s, i) => s + i.grossProfit, 0);
  const netProfit = items.reduce((s, i) => s + i.netProfit, 0);
  const marginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  return {
    revenue: round2(revenue),
    costOfGoods: round2(costOfGoods),
    grossProfit: round2(grossProfit),
    marginPercent: round2(marginPercent),
    netProfit: round2(netProfit),
  };
}
