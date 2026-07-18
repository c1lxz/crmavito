"use client";

import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CheckSquare, ExternalLink, History, Package, RefreshCw, Save, Search, Square } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/hooks/use-toast";
import { formatRub, matchesSearch } from "@/lib/utils";

type StockItem = {
  itemId: string;
  title: string;
  price: number;
  url: string | null;
  status: string | null;
  imageUrl: string | null;
  quantity: number | null;
  isUnlimited: boolean;
  isOutOfStock: boolean;
  isMultiple: boolean;
};

type StockInfo = {
  item_id: number | string;
  quantity?: number | null;
  is_unlimited?: boolean;
  is_out_of_stock?: boolean;
  is_multiple?: boolean;
};

type AvitoCredentialProfile = {
  id: string;
  name: string;
  accountId: string | null;
  reportEmail: string | null;
  isActive: boolean;
};

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

export function StocksClient() {
  const [credentialProfiles, setCredentialProfiles] = useState<AvitoCredentialProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [manualClientId, setManualClientId] = useState("");
  const [manualClientSecret, setManualClientSecret] = useState("");
  const [profilesOpen, setProfilesOpen] = useState(true);
  const [items, setItems] = useState<StockItem[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockProgress, setStockProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const dragSelection = useRef<{ active: boolean; shouldSelect: boolean }>({
    active: false,
    shouldSelect: true,
  });
  const stockLoadRun = useRef(0);

  const filtered = useMemo(
    () => items.filter((item) => matchesSearch(`${item.title} ${item.itemId}`, search)),
    [items, search],
  );

  const selectedCount = selected.size;
  const manualCredentialsComplete = Boolean(manualClientId.trim() && manualClientSecret.trim());
  const manualCredentialsPartial = Boolean(manualClientId.trim() || manualClientSecret.trim()) && !manualCredentialsComplete;
  const canLoad = (manualCredentialsComplete || Boolean(selectedProfileId)) && !manualCredentialsPartial && !loading;

  useEffect(() => {
    void refreshCredentialProfiles();
  }, []);

  useEffect(() => {
    function stopDragSelection() {
      dragSelection.current.active = false;
    }

    window.addEventListener("mouseup", stopDragSelection);
    return () => window.removeEventListener("mouseup", stopDragSelection);
  }, []);

  async function refreshCredentialProfiles(preferredId?: string) {
    const response = await fetch("/api/avito-profiles/credentials", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    const profiles: AvitoCredentialProfile[] = Array.isArray(data.profiles) ? data.profiles : [];
    setCredentialProfiles(profiles);

    const selected =
      profiles.find((profile) => profile.id === (preferredId || selectedProfileId)) ??
      profiles[0];
    if (selected) applyProfile(selected);
  }

  function applyProfile(profile: AvitoCredentialProfile) {
    setSelectedProfileId(profile.id);
  }

  function avitoAuthPayload() {
    return manualCredentialsComplete
      ? { clientId: manualClientId.trim(), clientSecret: manualClientSecret.trim() }
      : { profileId: selectedProfileId };
  }

  async function loadItems() {
    const runId = stockLoadRun.current + 1;
    stockLoadRun.current = runId;
    setLoading(true);
    setStockLoading(false);
    setStockProgress(null);
    setSelected(new Set());
    try {
      const response = await fetch("/api/avito/stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(avitoAuthPayload()),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить объявления");
      const loadedItems: StockItem[] = data.items ?? [];
      setItems(loadedItems);
      setDrafts(
        Object.fromEntries(
          loadedItems.map((item: StockItem) => [item.itemId, String(item.quantity ?? 0)]),
        ),
      );
      toast({
        title: "Объявления загружены",
        description: `Найдено: ${loadedItems.length}. Остатки загружаются фоном.`,
      });
      void loadStocksInBackground(loadedItems, runId);
    } catch (error) {
      toast({
        title: "Ошибка Avito",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadStocksInBackground(sourceItems: StockItem[], runId: number) {
    if (sourceItems.length === 0) return;
    const chunkSize = 50;
    let loaded = 0;
    let stopped = false;
    setStockLoading(true);
    setStockProgress({ loaded: 0, total: sourceItems.length });

    try {
      for (let i = 0; i < sourceItems.length; i += chunkSize) {
        if (stockLoadRun.current !== runId) return;
        const chunk = sourceItems.slice(i, i + chunkSize);
        const response = await fetch("/api/avito/stocks/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...avitoAuthPayload(), itemIds: chunk.map((item) => item.itemId) }),
        });
        const data = await readApiJson(response);
        if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить остатки");

        const stocks = new Map(
          ((data.stocks ?? []) as StockInfo[]).map((stock) => [String(stock.item_id), stock]),
        );
        setItems((current) =>
          current.map((item) => {
            const stock = stocks.get(item.itemId);
            if (!stock) return item;
            return {
              ...item,
              quantity: typeof stock.quantity === "number" ? stock.quantity : null,
              isUnlimited: Boolean(stock.is_unlimited),
              isOutOfStock: Boolean(stock.is_out_of_stock),
              isMultiple: Boolean(stock.is_multiple),
            };
          }),
        );
        setDrafts((current) => ({
          ...current,
          ...Object.fromEntries(
            [...stocks.entries()].map(([itemId, stock]) => [itemId, String(stock.quantity ?? 0)]),
          ),
        }));

        loaded = Math.min(i + chunk.length, sourceItems.length);
        setStockProgress({ loaded, total: sourceItems.length });
        if (data.warning) {
          stopped = true;
          toast({ title: "Остатки загружены частично", description: data.warning });
          break;
        }
        if (i + chunkSize < sourceItems.length) {
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      }

      if (!stopped && stockLoadRun.current === runId) {
        toast({ title: "Остатки загружены", description: `Проверено объявлений: ${sourceItems.length}` });
      }
    } catch (error) {
      if (stockLoadRun.current === runId) {
        toast({
          title: "Остатки загружены частично",
          description: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (stockLoadRun.current === runId) {
        setStockLoading(false);
      }
    }
  }

  async function saveUpdates(updates: { itemId: string; quantity: number }[]) {
    const response = await fetch("/api/avito/stocks/update", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...avitoAuthPayload(), updates }),
    });
    const data = await readApiJson(response);
    if (!response.ok) throw new Error(data.error ?? "Не удалось обновить остатки");
    const successful = new Set(
      (data.stocks ?? [])
        .filter((stock: { item_id: string | number; success?: boolean }) => stock.success !== false)
        .map((stock: { item_id: string | number }) => String(stock.item_id)),
    );
    return successful.size ? successful : new Set(updates.map((update) => update.itemId));
  }

  async function saveOne(itemId: string) {
    const quantity = Number(drafts[itemId]);
    if (!Number.isInteger(quantity) || quantity < 0) {
      toast({ title: "Остаток должен быть целым числом от 0", variant: "destructive" });
      return;
    }

    setSavingId(itemId);
    try {
      const successful = await saveUpdates([{ itemId, quantity }]);
      if (!successful.has(itemId)) throw new Error("Avito не подтвердил обновление");
      setItems((current) =>
        current.map((item) => (item.itemId === itemId ? { ...item, quantity } : item)),
      );
      toast({ title: "Остаток обновлён" });
    } catch (error) {
      toast({
        title: "Ошибка Avito",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function saveBulk() {
    const quantity = Number(bulkQuantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      toast({ title: "Остаток должен быть целым числом от 0", variant: "destructive" });
      return;
    }
    const updates = [...selected].map((itemId) => ({ itemId, quantity }));
    if (updates.length === 0) return;

    setBulkSaving(true);
    try {
      const successful = await saveUpdates(updates);
      setItems((current) =>
        current.map((item) => (successful.has(item.itemId) ? { ...item, quantity } : item)),
      );
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries([...successful].map((itemId) => [itemId, String(quantity)])),
      }));
      setSelected(new Set());
      toast({ title: "Остатки обновлены", description: `Позиций: ${successful.size}` });
    } catch (error) {
      toast({
        title: "Ошибка Avito",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setBulkSaving(false);
    }
  }

  function setItemSelection(itemId: string, shouldSelect: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (shouldSelect) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  function startDragSelection(itemId: string, isSelected: boolean, event: MouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const shouldSelect = !isSelected;
    dragSelection.current = { active: true, shouldSelect };
    setItemSelection(itemId, shouldSelect);
  }

  function applyDragSelection(itemId: string) {
    if (!dragSelection.current.active) return;
    setItemSelection(itemId, dragSelection.current.shouldSelect);
  }

  function toggleVisible() {
    setSelected((current) => {
      const visibleIds = filtered.map((item) => item.itemId);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of visibleIds) {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function selectFiltered() {
    setSelected(new Set(filtered.map((item) => item.itemId)));
  }

  function selectAllItems() {
    setSelected(new Set(items.map((item) => item.itemId)));
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center gap-3">
          <Link href="/settings" className="icon-tile h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Остатки Avito</h1>
            <p className="section-caption">Объявления и количество на выбранном аккаунте</p>
          </div>
          <Button size="sm" variant="outline" onClick={loadItems} disabled={!canLoad}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Загрузка" : "Загрузить"}
          </Button>
          {credentialProfiles.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setProfilesOpen((value) => !value)}>
              <History className="h-4 w-4" />
              Profiles
            </Button>
          )}
        </div>

        <div className="mb-3 grid gap-2 md:grid-cols-2">
          <Input
            placeholder="client_id вручную"
            value={manualClientId}
            onChange={(event) => setManualClientId(event.target.value)}
            autoComplete="off"
          />
          <Input
            placeholder="client_secret вручную"
            type="password"
            value={manualClientSecret}
            onChange={(event) => setManualClientSecret(event.target.value)}
            autoComplete="new-password"
          />
        </div>

        {profilesOpen && credentialProfiles.length > 0 && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {credentialProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => applyProfile(profile)}
                className={`rounded-md border p-3 text-left transition-colors hover:border-primary/30 hover:bg-accent/45 ${
                  selectedProfileId === profile.id ? "border-primary/40 bg-accent" : "border-border"
                }`}
              >
                <p className="truncate text-sm font-semibold">{profile.name}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {profile.accountId || profile.reportEmail || "Saved credentials"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="border-b border-border/80 bg-card/45 px-4 py-3">
          {stockProgress && (
            <div className="mb-3 text-xs text-muted-foreground">
              Остатки: {stockProgress.loaded} / {stockProgress.total}
              {stockLoading ? " загружаются" : " проверено"}
            </div>
          )}
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={toggleVisible}
              className="icon-tile h-9 w-9"
              aria-label="Выбрать видимые"
            >
              {filtered.length > 0 && filtered.every((item) => selected.has(item.itemId)) ? (
                <CheckSquare className="h-4 w-4" />
              ) : (
                <Square className="h-4 w-4" />
              )}
            </button>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск объявления..."
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step={1}
              className="h-9 w-32"
              placeholder="Остаток"
              value={bulkQuantity}
              onChange={(event) => setBulkQuantity(event.target.value)}
              disabled={selectedCount === 0}
            />
            <Button
              size="sm"
              onClick={saveBulk}
              disabled={selectedCount === 0 || bulkSaving}
              className="min-w-32"
            >
              {bulkSaving ? "Сохранение" : `Для выбранных: ${selectedCount}`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={selectFiltered}
              disabled={filtered.length === 0 || bulkSaving}
            >
              Все найденные: {filtered.length}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={selectAllItems}
              disabled={items.length === 0 || bulkSaving}
            >
              Все: {items.length}
            </Button>
          </div>
        </div>
      )}

      <div className="app-content space-y-3">
        {!loading && items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-10 w-10 opacity-45" />
            <p className="text-sm font-semibold">Введите ключи Avito и загрузите объявления</p>
          </div>
        )}

        {filtered.map((item) => {
          const isSelected = selected.has(item.itemId);
          const draft = drafts[item.itemId] ?? String(item.quantity ?? 0);
          const changed = Number(draft) !== (item.quantity ?? 0);

          return (
            <Card key={item.itemId} className="transition-colors hover:border-primary/25 hover:bg-accent/45">
              <CardContent className="flex items-center gap-3 p-3">
                <button
                  type="button"
                  onMouseDown={(event) => startDragSelection(item.itemId, isSelected, event)}
                  onMouseEnter={() => applyDragSelection(item.itemId)}
                  onClick={(event) => event.preventDefault()}
                  className="select-none text-muted-foreground transition-colors hover:text-primary"
                  aria-label={isSelected ? "Снять выбор" : "Выбрать"}
                >
                  {isSelected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
                </button>

                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
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
                  <p className="text-sm font-medium leading-tight">{item.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">ID {item.itemId}</span>
                    <span className="text-xs font-semibold">{formatRub(item.price)}</span>
                    {item.status && (
                      <Badge variant={item.status === "active" ? "success" : "warning"}>{item.status}</Badge>
                    )}
                    {item.isUnlimited && <Badge variant="secondary">Без лимита</Badge>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    className="h-9 w-24 text-right"
                    value={draft}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [item.itemId]: event.target.value }))
                    }
                  />
                  <Button
                    size="icon"
                    variant={changed ? "default" : "outline"}
                    className="h-9 w-9"
                    onClick={() => saveOne(item.itemId)}
                    disabled={savingId === item.itemId || !changed}
                    aria-label="Сохранить остаток"
                  >
                    {savingId === item.itemId ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : changed ? (
                      <Save className="h-4 w-4" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
