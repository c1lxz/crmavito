import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDashboardTopProducts } from "@/lib/dashboard/top-products-query";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await getDashboardTopProducts();
  return NextResponse.json(
    { products },
    { headers: { "cache-control": "no-store" } },
  );
}
