"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, RefreshCw, Package, ExternalLink, CheckCircle, Clock } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRub, formatDateTime } from "@/lib/utils";
import { toast } from "@/lib/hooks/use-toast";

interface Product {
  id: string;
  name: string;
  salePrice: number;
  avitoListingUrl: string | null;
  avitoListingStatus: string | null;
  avitoItemId: string | null;
  imageUrl: string | null;
  lastSyncedAt: string | null;
  ordersCount: number;
}

interface Props {
  products: Product[];
  isAdmin: boolean;
}

export function ProductsClient({ products: initial, isAdmin }: Props) {
  const router = useRouter();
  const [products, setProducts] = useState(initial);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/products/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка синхронизации");
      toast({ title: "Синхронизация завершена", description: `Обновлено товаров: ${data.updated ?? 0}` });
      router.refresh();
    } catch (e) {
      toast({ title: "Ошибка", description: String(e), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  const lastSync = products.find((p) => p.lastSyncedAt)?.lastSyncedAt;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b px-4 pt-12 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
          <h1 className="font-bold text-lg flex-1">Номенклатура</h1>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Синхр..." : "Avito"}
            </Button>
          )}
        </div>
        {lastSync && (
          <p className="text-xs text-muted-foreground mb-2">
            Последняя синхронизация: {formatDateTime(lastSync)}
          </p>
        )}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск товара..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Stats bar */}
      <div className="px-4 py-3 flex gap-4 text-sm border-b">
        <span className="text-muted-foreground">Всего: <span className="font-semibold text-foreground">{products.length}</span></span>
        <span className="text-muted-foreground">На Avito: <span className="font-semibold text-foreground">{products.filter((p) => p.avitoItemId).length}</span></span>
      </div>

      <div className="px-4 py-3 space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>{search ? "Ничего не найдено" : "Нет товаров"}</p>
            {!search && (
              <p className="text-xs mt-1">Добавьте объявления на Avito и нажмите «Avito» для синхронизации</p>
            )}
          </div>
        )}

        {filtered.map((product) => (
          <Card key={product.id}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl bg-muted overflow-hidden flex-shrink-0">
                {product.imageUrl ? (
                  <Image src={product.imageUrl} alt={product.name} width={56} height={56} className="object-cover w-full h-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm leading-tight">{product.name}</p>
                <p className="text-sm font-semibold text-primary mt-0.5">{formatRub(product.salePrice)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">{product.ordersCount} заказов</span>
                  {product.avitoItemId && (
                    <span className="flex items-center gap-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircle className="h-3 w-3" /> Avito
                    </span>
                  )}
                  {product.avitoListingStatus && product.avitoListingStatus !== "active" && (
                    <span className="flex items-center gap-0.5 text-xs text-amber-600">
                      <Clock className="h-3 w-3" /> {product.avitoListingStatus}
                    </span>
                  )}
                </div>
              </div>

              {product.avitoListingUrl && (
                <a
                  href={product.avitoListingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
