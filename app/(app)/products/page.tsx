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
      avitoListings: {
        include: { avitoProfile: { select: { id: true, name: true, color: true } } },
        orderBy: { updatedAt: "desc" },
      },
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
    listings: p.avitoListings.map((listing) => ({
      id: listing.id,
      profileId: listing.avitoProfile.id,
      profileName: listing.avitoProfile.name,
      profileColor: listing.avitoProfile.color,
      avitoItemId: listing.avitoItemId,
      listingUrl: listing.listingUrl,
      listingStatus: listing.listingStatus,
    })),
  }));
}

async function getProfiles() {
  return prisma.avitoProfile.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true, clientId: true, clientSecret: true },
  }).then((profiles) => profiles.map(({ clientId, clientSecret, ...profile }) => ({
    ...profile,
    hasCredentials: Boolean(clientId && clientSecret),
  })));
}

export default async function ProductsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [products, profiles] = await Promise.all([getProducts(), getProfiles()]);
  const isAdmin = session.user.role === "ADMIN";

  return <ProductsClient products={products} profiles={profiles} isAdmin={isAdmin} />;
}
