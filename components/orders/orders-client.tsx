"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Check, ChevronRight, Clipboard, Copy, Package, PackageOpen, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/lib/hooks/use-toast";
import { formatRub, formatDate } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/constants";
import { buildOrderFilterQuery } from "@/lib/orders/filters";
import { CreateOrderDialog } from "./create-order-dialog";
import type { OrderStatus } from "@prisma/client";

interface Order {
  id: string;
  orderNumber: string;
  productNameSnapshot: string;
  variant: string | null;
  trackingNumber: string;
  quantity: number;
  status: OrderStatus;
  orderDate: string | Date;
  destinationCity: string | null;
  revenue: number;
  netProfit: number;
  salePriceAtOrder: number;
  purchasePricePerUnit: number;
  logisticsCost: number;
  commissionCost: number;
  otherCosts: number;
  product: { imageUrl: string | null };
  counterparty: { id: string; name: string };
  avitoProfile: { id: string; name: string; color: string | null; isActive: boolean } | null;
}

interface Props {
  initialOrders: Order[];
  counterparties: { id: string; name: string }[];
  products: { id: string; name: string; salePrice: number | string; imageUrl?: string | null }[];
  avitoProfiles: { id: string; name: string; color: string | null; isActive: boolean }[];
  depositedReturns: Array<{
    id: string;
    productId: string;
    productNameSnapshot: string;
    size: string | null;
    variant: string | null;
    trackingNumber: string;
  }>;
  totalRevenue: number;
  totalProfit: number;
  initialOpen?: boolean;
  focusSearch?: boolean;
  initialSearch?: string;
  initialStatusFilter?: string;
  initialCounterpartyFilter?: string;
  initialAvitoProfileFilter?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
}

const EDITABLE_STATUSES: OrderStatus[] = [
  "ACCEPTED",
  "SHIPPED",
  "RECEIVED",
  "RETURNING",
  "RETURNED",
  "CANCELLED",
];

export function OrdersClient({
  initialOrders,
  counterparties,
  products,
  avitoProfiles,
  depositedReturns,
  totalRevenue,
  totalProfit,
  initialOpen = false,
  focusSearch = false,
  initialSearch = "",
  initialStatusFilter = "ALL",
  initialCounterpartyFilter = "ALL",
  initialAvitoProfileFilter = "ALL",
  initialDateFrom = "",
  initialDateTo = "",
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [orders, setOrders] = useState(initialOrders);
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatusFilter in ORDER_STATUS_LABELS ? initialStatusFilter : "ALL",
  );
  const [counterpartyFilter, setCounterpartyFilter] = useState(
    counterparties.some((counterparty) => counterparty.id === initialCounterpartyFilter)
      ? initialCounterpartyFilter
      : "ALL",
  );
  const [avitoProfileFilter, setAvitoProfileFilter] = useState(
    avitoProfiles.some((profile) => profile.id === initialAvitoProfileFilter)
      ? initialAvitoProfileFilter
      : "ALL",
  );
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [showCreate, setShowCreate] = useState(initialOpen);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<OrderStatus | "">("");
  const [bulkCounterpartyId, setBulkCounterpartyId] = useState("");
  const [bulkPurchasePrice, setBulkPurchasePrice] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [filtersHidden, setFiltersHidden] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastScrollYRef = useRef(0);

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  useEffect(() => {
    if (!initialOpen) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [initialOpen]);

  useEffect(() => {
    if (focusSearch) searchInputRef.current?.focus();
  }, [focusSearch]);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;

    const handleScroll = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollYRef.current;
      lastScrollYRef.current = currentY;

      if (currentY < 24) {
        setFiltersHidden(false);
        return;
      }
      if (delta > 8) setFiltersHidden(true);
      if (delta < -8) setFiltersHidden(false);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "ALL" && o.status !== statusFilter) return false;
      if (counterpartyFilter !== "ALL" && o.counterparty.id !== counterpartyFilter) {
        return false;
      }
      if (avitoProfileFilter !== "ALL" && o.avitoProfile?.id !== avitoProfileFilter) {
        return false;
      }
      const orderDay = new Date(o.orderDate).toISOString().slice(0, 10);
      if (dateFrom && orderDay < dateFrom) return false;
      if (dateTo && orderDay > dateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          o.productNameSnapshot.toLowerCase().includes(q) ||
          o.trackingNumber.toLowerCase().includes(q) ||
          o.orderNumber.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [avitoProfileFilter, counterpartyFilter, dateFrom, dateTo, orders, search, statusFilter]);

  const statuses: Array<{ value: string; label: string }> = [
    { value: "ALL", label: "Все статусы" },
    ...Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l })),
  ];

  const filteredIds = useMemo(() => filtered.map((order) => order.id), [filtered]);
  const returnQuery = useMemo(
    () =>
      buildOrderFilterQuery({
        q: search,
        status: statusFilter,
        counterpartyId: counterpartyFilter,
        avitoProfileId: avitoProfileFilter,
        dateFrom,
        dateTo,
      }),
    [avitoProfileFilter, counterpartyFilter, dateFrom, dateTo, search, statusFilter],
  );
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const parsedBulkPurchasePrice = Number(bulkPurchasePrice);
  const hasValidBulkPurchasePrice =
    bulkPurchasePrice !== "" &&
    Number.isFinite(parsedBulkPurchasePrice) &&
    parsedBulkPurchasePrice >= 0;

  function toggleSelectionMode() {
    if (selectionMode) {
      setSelectedIds(new Set());
      setBulkStatus("");
      setBulkCounterpartyId("");
      setBulkPurchasePrice("");
    }
    setSelectionMode(!selectionMode);
  }

  function toggleOrder(orderId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function updateSelectedStatuses() {
    if (!bulkStatus || selectedIds.size === 0) return;
    await applyBulkAction(
      { action: "status", status: bulkStatus },
      "Статусы обновлены",
      "Не удалось обновить статусы",
      (current, changedIds) =>
        current.map((order) =>
          changedIds.has(order.id)
            ? {
                ...order,
                status: bulkStatus,
                salePriceAtOrder:
                  bulkStatus === "RETURNING" ||
                  bulkStatus === "RETURNED" ||
                  bulkStatus === "CANCELLED"
                    ? 0
                    : order.salePriceAtOrder,
                purchasePricePerUnit:
                  bulkStatus === "CANCELLED" ? 0 : order.purchasePricePerUnit,
              }
            : order,
        ),
    );
  }

  async function applyBulkAction(
    payload: Record<string, unknown>,
    successTitle: string,
    errorTitle: string,
    updateLocalOrders?: (current: Order[], changedIds: Set<string>) => Order[],
  ) {
    if (selectedIds.size === 0) return;
    setIsUpdating(true);
    try {
      const response = await fetch("/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          orderIds: [...selectedIds],
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error ?? "Не удалось обновить заказы");
      }

      const changedIds = new Set(selectedIds);
      if (updateLocalOrders) {
        setOrders((current) => updateLocalOrders(current, changedIds));
      }
      toast({
        title: successTitle,
        description: `${result.updatedCount} из ${selectedIds.size} заказов`,
      });
      setSelectedIds(new Set());
      setBulkStatus("");
      setBulkCounterpartyId("");
      setBulkPurchasePrice("");
      setSelectionMode(false);
      router.refresh();
    } catch (error) {
      toast({
        title: errorTitle,
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  }

  async function updateSelectedCounterparty() {
    if (!bulkCounterpartyId) return;
    const counterparty = counterparties.find(
      (item) => item.id === bulkCounterpartyId,
    );
    if (!counterparty) return;
    await applyBulkAction(
      { action: "counterparty", counterpartyId: bulkCounterpartyId },
      "Контрагент обновлён",
      "Не удалось обновить контрагента",
      (current, changedIds) =>
        current.map((order) =>
          changedIds.has(order.id) ? { ...order, counterparty } : order,
        ),
    );
  }

  async function updateSelectedPurchasePrice() {
    if (!hasValidBulkPurchasePrice) return;
    await applyBulkAction(
      {
        action: "purchasePrice",
        purchasePricePerUnit: parsedBulkPurchasePrice,
      },
      "Стоимость закупки обновлена",
      "Не удалось обновить стоимость закупки",
    );
  }

  async function copyTrackingNumbers(trackingNumbers: string[]) {
    const text = trackingNumbers.filter(Boolean).join("\n");
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) {
        toast({
          title: "Не удалось скопировать",
          description: "Разрешите доступ к буферу обмена",
          variant: "destructive",
        });
        return;
      }
    }
    toast({
      title: "Скопировано",
      description:
        trackingNumbers.length === 1
          ? trackingNumbers[0]
          : `${trackingNumbers.length} трек-номеров`,
    });
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Заказы</h1>
            <p className="section-caption">Всего {filtered.length} из {orders.length}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={selectionMode ? "secondary" : "outline"}
              onClick={toggleSelectionMode}
              aria-pressed={selectionMode}
            >
              {selectionMode ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {selectionMode ? "Отмена" : "Выбрать"}
            </Button>
            {!selectionMode && (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" />
                Новый заказ
              </Button>
            )}
          </div>
        </div>
        <div
          className={`orders-filter-panel space-y-2 transition-[max-height,opacity,transform,margin] duration-200 ease-out ${
            filtersHidden
              ? "max-h-0 -translate-y-2 overflow-hidden opacity-0"
              : "max-h-[32rem] translate-y-0 opacity-100"
          }`}
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Поиск по заказам, треку или товару"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="pc-chip-wrap flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {statuses.map((s) => (
              <button
                key={s.value}
                onClick={() => setStatusFilter(s.value)}
                className={`filter-chip ${
                  statusFilter === s.value
                    ? "filter-chip-active"
                    : ""
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="pc-orders-date-grid grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              С даты
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              По дату
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
          </div>
          <label className="pc-inline-half block space-y-1 text-xs font-medium text-muted-foreground">
            Контрагент
            <Select value={counterpartyFilter} onValueChange={setCounterpartyFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Все контрагенты" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Все контрагенты</SelectItem>
                {counterparties.map((counterparty) => (
                  <SelectItem key={counterparty.id} value={counterparty.id}>
                    {counterparty.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="pc-inline-half pc-inline-half-right block space-y-1 text-xs font-medium text-muted-foreground">
            Профиль Avito
            <Select value={avitoProfileFilter} onValueChange={setAvitoProfileFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Все профили Avito" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Все профили Avito</SelectItem>
                {avitoProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {selectionMode && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
              <p className="text-xs font-semibold">
                Выбрано: <span className="tabular-nums text-primary">{selectedIds.size}</span>
              </p>
              <button
                type="button"
                onClick={toggleFiltered}
                disabled={filteredIds.length === 0}
                className="text-xs font-semibold text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
              >
                {allFilteredSelected ? "Снять найденные" : `Выбрать найденные (${filteredIds.length})`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="app-content space-y-3">
        {selectionMode && selectedIds.size > 0 && (
          <div className="sticky top-[calc(var(--app-top-pad)+19.25rem)] z-20 space-y-2 rounded-lg border border-primary/25 bg-card p-2 shadow-lg shadow-foreground/10">
            <div className="flex gap-2">
              <Select
                value={bulkStatus}
                onValueChange={(value) => setBulkStatus(value as OrderStatus)}
                disabled={isUpdating}
              >
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue placeholder="Новый статус" />
                </SelectTrigger>
                <SelectContent>
                  {EDITABLE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {ORDER_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={updateSelectedStatuses}
                disabled={!bulkStatus || isUpdating}
                className="shrink-0"
                aria-label="Применить новый статус"
              >
                Применить
              </Button>
            </div>
            <div className="flex gap-2">
              <Select
                value={bulkCounterpartyId}
                onValueChange={setBulkCounterpartyId}
                disabled={isUpdating}
              >
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue placeholder="Новый контрагент" />
                </SelectTrigger>
                <SelectContent>
                  {counterparties.map((counterparty) => (
                    <SelectItem key={counterparty.id} value={counterparty.id}>
                      {counterparty.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={updateSelectedCounterparty}
                disabled={!bulkCounterpartyId || isUpdating}
                className="shrink-0"
                aria-label="Применить нового контрагента"
              >
                Применить
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={bulkPurchasePrice}
                onChange={(event) => setBulkPurchasePrice(event.target.value)}
                placeholder="Закупка за единицу, ₽"
                disabled={isUpdating}
                className="min-w-0 flex-1"
              />
              <Button
                onClick={updateSelectedPurchasePrice}
                disabled={
                  !hasValidBulkPurchasePrice || isUpdating
                }
                className="shrink-0"
                aria-label="Применить стоимость закупки"
              >
                Применить
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                void copyTrackingNumbers(
                  orders
                    .filter((order) => selectedIds.has(order.id))
                    .map((order) => order.trackingNumber),
                )
              }
              className="w-full"
              disabled={isUpdating}
            >
              <Clipboard className="h-4 w-4" />
              Скопировать трек-номера
            </Button>
          </div>
        )}
        <div className="pc-stats-wide grid grid-cols-3 gap-2">
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">Выручка</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{formatRub(totalRevenue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">Прибыль</p>
              <p className="mt-1 text-sm font-semibold tabular-nums money-positive">{formatRub(totalProfit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">Позиций</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{filtered.length}</p>
            </CardContent>
          </Card>
        </div>

        <div className="pc-only hidden overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-border bg-muted/55 text-left text-xs font-semibold text-muted-foreground">
              <tr>
                {selectionMode && <th className="w-12 px-4 py-3">Выбор</th>}
                <th className="w-28 px-4 py-3">Заказ</th>
                <th className="px-4 py-3">Товар</th>
                <th className="w-44 px-4 py-3">Трек</th>
                <th className="w-40 px-4 py-3">Статус</th>
                <th className="w-36 px-4 py-3 text-right">Сумма</th>
                <th className="w-32 px-4 py-3 text-right">Прибыль</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((order) => {
                const selected = selectedIds.has(order.id);
                const row = (
                  <>
                    {selectionMode && (
                      <td className="px-4 py-3">
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 items-center justify-center rounded border ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background text-transparent"
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 align-top">
                      <p className="font-semibold">№{order.orderNumber}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(order.orderDate)}</p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                          {order.product.imageUrl ? (
                            <Image
                              src={order.product.imageUrl}
                              alt={order.productNameSnapshot}
                              width={40}
                              height={40}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <Package className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{order.productNameSnapshot}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {order.variant ? `${order.variant} · ` : ""}
                            {order.quantity} шт.
                            {order.avitoProfile ? ` · ${order.avitoProfile.name}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex min-w-0 items-center gap-1">
                        <span className="truncate font-mono text-xs">{order.trackingNumber}</span>
                        {!selectionMode && (
                          <button
                            type="button"
                            className="rounded p-1 text-primary hover:bg-primary/10"
                            aria-label={`Скопировать трек-номер ${order.trackingNumber}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void copyTrackingNumbers([order.trackingNumber]);
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLORS[order.status]}`}>
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-top font-semibold tabular-nums">
                      {formatRub(order.salePriceAtOrder * order.quantity)}
                    </td>
                    <td className="px-4 py-3 text-right align-top font-semibold tabular-nums money-positive">
                      +{formatRub(order.netProfit)}
                    </td>
                  </>
                );

                return (
                  <tr
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectionMode ? selected : undefined}
                    onClick={() => {
                      if (selectionMode) toggleOrder(order.id);
                      else {
                        router.push(
                          `/orders/${order.id}${
                            returnQuery ? `?returnTo=${encodeURIComponent(returnQuery)}` : ""
                          }`,
                        );
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      if (selectionMode) toggleOrder(order.id);
                      else {
                        router.push(
                          `/orders/${order.id}${
                            returnQuery ? `?returnTo=${encodeURIComponent(returnQuery)}` : ""
                          }`,
                        );
                      }
                    }}
                    className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                      selected ? "bg-accent/70" : "hover:bg-accent/45"
                    }`}
                  >
                    {row}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mobile-only space-y-3">
        {filtered.map((order) => {
          const selected = selectedIds.has(order.id);
          const content = (
            <Card
              className={`transition-colors ${
                selected
                  ? "border-primary bg-accent/70 ring-1 ring-primary/20"
                  : "hover:border-primary/25 hover:bg-accent/45"
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {selectionMode && (
                    <span
                      aria-hidden="true"
                      className={`mt-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-transparent"
                      }`}
                    >
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </span>
                  )}
                  <div className="w-12 h-12 rounded-md bg-muted overflow-hidden flex-shrink-0">
                    {order.product.imageUrl ? (
                      <Image src={order.product.imageUrl} alt={order.productNameSnapshot} width={48} height={48} className="object-cover w-full h-full" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Package className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">№{order.orderNumber} · {formatDate(order.orderDate)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ORDER_STATUS_COLORS[order.status]}`}>
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </div>
                    <p className="font-medium text-sm mt-0.5 truncate">{order.productNameSnapshot}</p>
                    {order.variant && <p className="text-xs text-muted-foreground">Цвет: {order.variant}</p>}
                    {order.avitoProfile && (
                      <p className="text-xs text-muted-foreground">Avito: {order.avitoProfile.name}</p>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                        <span className="truncate">Трек: {order.trackingNumber}</span>
                        {!selectionMode ? (
                          <button
                            type="button"
                            className="rounded p-1 text-primary hover:bg-primary/10"
                            aria-label={`Скопировать трек-номер ${order.trackingNumber}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void copyTrackingNumbers([order.trackingNumber]);
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <span className="mx-1">·</span>
                        <span>{order.quantity} шт.</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatRub(order.salePriceAtOrder * order.quantity)}</p>
                        <p className="text-xs font-semibold money-positive">+{formatRub(order.netProfit)}</p>
                      </div>
                    </div>
                  </div>
                  {!selectionMode && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  )}
                </div>
              </CardContent>
            </Card>
          );

          return selectionMode ? (
            <button
              key={order.id}
              type="button"
              onClick={() => toggleOrder(order.id)}
              aria-pressed={selected}
              aria-label={`${selected ? "Снять выбор" : "Выбрать"}: заказ №${order.orderNumber}`}
              className="block w-full text-left"
            >
              {content}
            </button>
          ) : (
            <Link
              key={order.id}
              href={`/orders/${order.id}${
                returnQuery ? `?returnTo=${encodeURIComponent(returnQuery)}` : ""
              }`}
              className="block"
            >
              {content}
            </Link>
          );
        })}
        </div>
        {filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-16 flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center">
              <PackageOpen className="h-8 w-8 text-muted-foreground/70" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium">Заказов не найдено</p>
          </div>
        )}
      </div>

      <CreateOrderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        counterparties={counterparties}
        avitoProfiles={avitoProfiles}
        products={products.map((p) => ({ ...p, salePrice: typeof p.salePrice === 'string' ? parseFloat(p.salePrice) : p.salePrice }))}
        depositedReturns={depositedReturns}
      />
    </div>
  );
}
