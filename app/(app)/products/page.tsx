import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProductsClient } from "@/components/products/products-client";
import { toDecimalNumber } from "@/lib/db/orders";

async function getProducts() {
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { orders: true } },
    },
  });

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    salePrice: toDecimalNumber(p.salePrice),
    avitoListingUrl: p.avitoListingUrl,
    avitoListingStatus: p.avitoListingStatus,
    avitoItemId: p.avitoItemId,
    imageUrl: p.imageUrl,
    lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
    ordersCount: p._count.orders,
  }));
}

export default async function ProductsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const products = await getProducts();
  const isAdmin = session.user.role === "ADMIN";

  return <ProductsClient products={products} isAdmin={isAdmin} />;
}
