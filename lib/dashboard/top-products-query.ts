import { prisma } from "@/lib/db/prisma";
import { getArchivedSourceOrderExclusion } from "@/lib/orders/warehouse-match";
import { buildTopProductsByOrders } from "@/lib/dashboard/top-products";

export async function getDashboardTopProducts(limit = 5) {
  const orders = await prisma.order.findMany({
    where: {
      isDeleted: false,
      status: { not: "CANCELLED" },
      ...getArchivedSourceOrderExclusion(),
    },
    select: {
      productId: true,
      productNameSnapshot: true,
      product: { select: { imageUrl: true } },
      items: {
        select: {
          productId: true,
          productNameSnapshot: true,
          product: { select: { imageUrl: true } },
        },
        orderBy: { position: "asc" },
      },
    },
  });

  return buildTopProductsByOrders(orders, limit);
}
