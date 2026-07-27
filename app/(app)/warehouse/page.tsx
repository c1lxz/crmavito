import { prisma } from "@/lib/db/prisma";
import { WarehouseClient, type WarehouseItem } from "@/components/warehouse/warehouse-client";

async function getWarehouseItems(): Promise<WarehouseItem[]> {
  const returns = await prisma.return.findMany({
    where: {
      status: "RETURNED",
      OR: [
        { orderId: null },
        { order: { isDeleted: false, status: { not: "CANCELLED" } } },
      ],
    },
    include: {
      product: { select: { name: true, imageUrl: true } },
      order: { select: { id: true, orderNumber: true, isDeleted: true } },
      usedByOrderItems: {
        select: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              isDeleted: true,
              shippingDate: true,
              updatedAt: true,
            },
          },
        },
      },
    },
    orderBy: [{ returnDate: "desc" }, { createdAt: "desc" }],
  });

  return returns.map((returnedItem) => {
    const usedByOrder = returnedItem.usedByOrderItems[0]?.order ?? null;
    const state: WarehouseItem["state"] = usedByOrder
      ? "ARCHIVED"
      : "AVAILABLE";

    return {
      id: returnedItem.id,
      productName:
        returnedItem.productNameSnapshot || returnedItem.product.name,
      imageUrl: returnedItem.product.imageUrl,
      variant: returnedItem.variant,
      size: returnedItem.size,
      trackingNumber: returnedItem.trackingNumber,
      returnDate: returnedItem.returnDate?.toISOString() ?? null,
      state,
      sourceOrder:
        returnedItem.order && !returnedItem.order.isDeleted
          ? {
              id: returnedItem.order.id,
              orderNumber: returnedItem.order.orderNumber,
            }
          : null,
      usedByOrder: usedByOrder
        ? {
            id: usedByOrder.id,
            orderNumber: usedByOrder.orderNumber,
            isDeleted: usedByOrder.isDeleted,
          }
        : null,
      archivedAt: usedByOrder
        ? (usedByOrder.shippingDate ?? usedByOrder.updatedAt).toISOString()
        : null,
    };
  });
}

export default async function WarehousePage() {
  const items = await getWarehouseItems();
  return <WarehouseClient items={items} />;
}
