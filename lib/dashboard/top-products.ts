interface TopProductItem {
  productId: string;
  productNameSnapshot: string;
  product: { imageUrl: string | null };
}

interface TopProductOrder {
  productId: string;
  productNameSnapshot: string;
  product: { imageUrl: string | null };
  items: TopProductItem[];
}

export interface TopProductByOrders {
  id: string;
  name: string;
  imageUrl: string | null;
  orders: number;
}

export function normalizeTopProductName(name: string): string {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildTopProductsByOrders(
  orders: TopProductOrder[],
  limit = 5,
): TopProductByOrders[] {
  const totals = new Map<string, TopProductByOrders>();

  for (const order of orders) {
    const items = order.items.length
      ? order.items
      : [{
          productId: order.productId,
          productNameSnapshot: order.productNameSnapshot,
          product: order.product,
        }];
    const namesInOrder = new Set<string>();

    for (const item of items) {
      const normalizedName = normalizeTopProductName(item.productNameSnapshot);
      const key = normalizedName || `product:${item.productId}`;
      if (namesInOrder.has(key)) continue;
      namesInOrder.add(key);

      const existing = totals.get(key);
      if (existing) {
        existing.orders += 1;
        if (!existing.imageUrl && item.product.imageUrl) {
          existing.imageUrl = item.product.imageUrl;
        }
        continue;
      }

      totals.set(key, {
        id: key,
        name: item.productNameSnapshot.trim().replace(/\s+/g, " "),
        imageUrl: item.product.imageUrl,
        orders: 1,
      });
    }
  }

  return [...totals.values()]
    .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name, "ru"))
    .slice(0, limit);
}
