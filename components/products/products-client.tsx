"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, Clock, ExternalLink, Package, RefreshCw, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/hooks/use-toast";
import { formatDateTime, formatRub, matchesSearch } from "@/lib/utils";

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

async function readApiJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const cleanText = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return {
      error: cleanText
        ? `Сервер вернул не JSON: ${cleanText.slice(0, 220)}`
        : "Сервер вернул пустой некорректный ответ",
    };
  }
}

export function ProductsClient({ products: initial, isAdmin }: Props) {
  const router = useRouter();
  const [products, setProducts] = useState(initial);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setProducts(initial);
  }, [initial]);

  const filtered = products.filter((product) => matchesSearch(product.name, search));
  const lastSync = products.find((product) => product.lastSyncedAt)?.lastSyncedAt;

  async function handleSync() {
    setSyncing(true);

    try {
      const res = await fetch("/api/products/sync", { method: "POST" });
      const data = await readApiJson(res);

      if (!res.ok) {
        throw new Error(data.error ?? "Ошибка синхронизации");
      }

      toast({
        title: "Синхронизация завершена",
        description: `Создано: ${data.created ?? 0}, обновлено: ${data.updated ?? 0}`,
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Ошибка Avito",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center gap-3">
          <Link href="/dashboard" className="icon-tile h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Номенклатура</h1>
            <p className="section-caption">{filtered.length} товаров</p>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`mr-1 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Синхр..." : "Avito"}
            </Button>
          )}
        </div>

        {lastSync && (
          <p className="mb-2 text-xs text-muted-foreground">
            Последняя синхронизация: {formatDateTime(lastSync)}
          </p>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск товара..."
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="pc-summary-wide flex gap-4 border-b border-border/80 bg-card/45 px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          Всего: <span className="font-semibold text-foreground">{products.length}</span>
        </span>
        <span className="text-muted-foreground">
          На Avito: <span className="font-semibold text-foreground">{products.filter((product) => product.avitoItemId).length}</span>
        </span>
      </div>

      <div className="pc-products-grid app-content grid gap-3">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-10 w-10 opacity-45" />
            <p className="text-sm font-semibold">{search ? "Ничего не найдено" : "Нет товаров"}</p>
            {!search && (
              <p className="mt-1 text-xs">
                Добавьте объявления на Avito и нажмите “Avito” для синхронизации.
              </p>
            )}
          </div>
        )}

        {filtered.map((product) => (
          <Card key={product.id} className="transition-colors hover:border-primary/25 hover:bg-accent/45">
            <CardContent className="flex items-center gap-3 p-3">
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                {product.imageUrl ? (
                  <Image
                    src={product.imageUrl}
                    alt={product.name}
                    width={56}
                    height={56}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Package className="h-5 w-5" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight">{product.name}</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{formatRub(product.salePrice)}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{product.ordersCount} заказов</span>
                  {product.avitoItemId && (
                    <span className="flex items-center gap-0.5 text-xs money-positive">
                      <CheckCircle className="h-3 w-3" /> Avito
                    </span>
                  )}
                  {product.avitoListingStatus && product.avitoListingStatus !== "active" && (
                    <span className="flex items-center gap-0.5 text-xs text-warning">
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
