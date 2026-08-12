"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, ChevronDown, Clock, ExternalLink, Package, RefreshCw, Search, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/hooks/use-toast";
import { cn, formatDateTime, formatRub, matchesSearch } from "@/lib/utils";

interface ProductListing {
  id: string;
  profileId: string;
  profileName: string;
  profileColor: string | null;
  avitoItemId: string;
  listingUrl: string | null;
  listingStatus: string | null;
}

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
  listings: ProductListing[];
}

interface Profile {
  id: string;
  name: string;
  color: string | null;
  hasCredentials: boolean;
}

interface Props {
  products: Product[];
  profiles: Profile[];
  isAdmin: boolean;
}

async function readApiJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const cleanText = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return { error: cleanText ? `Сервер вернул некорректный ответ: ${cleanText.slice(0, 220)}` : "Сервер вернул пустой ответ" };
  }
}

export function ProductsClient({ products: initial, profiles, isAdmin }: Props) {
  const router = useRouter();
  const availableProfileIds = profiles.filter((profile) => profile.hasCredentials).map((profile) => profile.id);
  const [products, setProducts] = useState(initial);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>(availableProfileIds);

  useEffect(() => setProducts(initial), [initial]);

  const filtered = products.filter((product) =>
    matchesSearch([product.name, ...product.listings.map((listing) => listing.profileName)].join(" "), search),
  );
  const lastSync = products.reduce<string | null>((latest, product) => {
    if (!product.lastSyncedAt) return latest;
    return !latest || product.lastSyncedAt > latest ? product.lastSyncedAt : latest;
  }, null);

  function toggleProfile(profileId: string) {
    setSelectedProfileIds((current) =>
      current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId],
    );
  }

  async function handleSync() {
    if (selectedProfileIds.length === 0) {
      setShowProfiles(true);
      toast({ title: "Выберите профили", description: "Нужен хотя бы один профиль с настроенными API-ключами.", variant: "destructive" });
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/products/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileIds: selectedProfileIds }),
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error ?? "Ошибка синхронизации");

      const failed = Array.isArray(data.errors) ? data.errors : [];
      toast({
        title: failed.length ? "Синхронизация завершена частично" : "Товары синхронизированы",
        description: failed.length
          ? `Готово профилей: ${data.profiles?.length ?? 0}. Ошибки: ${failed.map((item: { profileName: string }) => item.profileName).join(", ")}`
          : `Профилей: ${data.profiles?.length ?? 0}, новых: ${data.created ?? 0}, обновлено: ${data.updated ?? 0}${data.merged ? `, объединено дублей: ${data.merged}` : ""}`,
        variant: failed.length ? "destructive" : "default",
      });
      router.refresh();
    } catch (error) {
      toast({ title: "Ошибка Avito", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center gap-3">
          <Link href="/dashboard" className="icon-tile h-9 w-9" aria-label="Вернуться на главную">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Номенклатура</h1>
            <p className="section-caption">Общий список · {filtered.length} товаров</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={handleSync} disabled={syncing || availableProfileIds.length === 0}>
              <RefreshCw className={cn("mr-1.5 h-4 w-4", syncing && "animate-spin")} />
              {syncing ? "Синхронизация…" : "Синхронизировать"}
            </Button>
          )}
        </div>

        {isAdmin && (
          <div className="mb-3 rounded-lg border bg-background/60">
            <button
              type="button"
              onClick={() => setShowProfiles((value) => !value)}
              className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={showProfiles}
            >
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 font-medium">Профили Avito</span>
              <span className="text-xs text-muted-foreground">Выбрано {selectedProfileIds.length} из {availableProfileIds.length}</span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showProfiles && "rotate-180")} />
            </button>
            {showProfiles && (
              <div className="border-t px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">Товары всех выбранных профилей попадут в один список без повторов.</p>
                  <button type="button" className="shrink-0 text-xs font-medium text-primary hover:underline" onClick={() => setSelectedProfileIds(availableProfileIds)}>
                    Выбрать все
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {profiles.map((profile) => {
                    const checked = selectedProfileIds.includes(profile.id);
                    return (
                      <label key={profile.id} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors", checked && "border-primary/40 bg-primary/5", !profile.hasCredentials && "cursor-not-allowed opacity-55")}>
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} disabled={!profile.hasCredentials || syncing} onChange={() => toggleProfile(profile.id)} />
                        <span className="h-2 w-2 rounded-full bg-muted-foreground" style={profile.color ? { backgroundColor: profile.color } : undefined} />
                        <span>{profile.name}</span>
                        {!profile.hasCredentials && <span className="text-xs text-muted-foreground">нет API-ключей</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {lastSync && <p className="mb-2 text-xs text-muted-foreground">Последняя синхронизация: {formatDateTime(lastSync)}</p>}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Поиск по товару или профилю…" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>

      <div className="pc-summary-wide flex gap-4 border-b border-border/80 bg-card/45 px-4 py-3 text-sm">
        <span className="text-muted-foreground">Всего: <span className="font-semibold text-foreground">{products.length}</span></span>
        <span className="text-muted-foreground">С Avito: <span className="font-semibold text-foreground">{products.filter((product) => product.listings.length || product.avitoItemId).length}</span></span>
      </div>

      <div className="pc-products-grid app-content grid gap-3">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-10 w-10 opacity-45" />
            <p className="text-sm font-semibold">{search ? "Ничего не найдено" : "Нет товаров"}</p>
            {!search && <p className="mt-1 text-xs">Выберите профили Avito и запустите синхронизацию.</p>}
          </div>
        )}

        {filtered.map((product) => {
          const primaryListing = product.listings[0];
          const listingUrl = primaryListing?.listingUrl ?? product.avitoListingUrl;
          const listingStatus = primaryListing?.listingStatus ?? product.avitoListingStatus;
          return (
            <Card key={product.id} className="transition-colors hover:border-primary/25 hover:bg-accent/45">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                  {product.imageUrl ? <Image src={product.imageUrl} alt={product.name} width={56} height={56} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Package className="h-5 w-5" /></div>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">{product.name}</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{formatRub(product.salePrice)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs text-muted-foreground">{product.ordersCount} заказов</span>
                    {product.listings.length > 0 ? product.listings.map((listing) => (
                      <span key={listing.id} className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" style={listing.profileColor ? { backgroundColor: listing.profileColor } : undefined} />
                        {listing.profileName}
                      </span>
                    )) : product.avitoItemId ? <span className="flex items-center gap-0.5 text-xs money-positive"><CheckCircle className="h-3 w-3" /> Avito</span> : null}
                    {listingStatus && listingStatus !== "active" && <span className="flex items-center gap-0.5 text-xs text-warning"><Clock className="h-3 w-3" /> {listingStatus}</span>}
                  </div>
                </div>
                {listingUrl && <a href={listingUrl} target="_blank" rel="noopener noreferrer" className="p-2 text-muted-foreground hover:text-foreground" aria-label={`Открыть ${product.name} на Avito`}><ExternalLink className="h-4 w-4" /></a>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
