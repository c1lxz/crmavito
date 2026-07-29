"use client";

import { useState } from "react";
import { ArrowLeft, Search, Filter } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";

interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  timestamp: string;
  user: { name: string; email: string };
}

interface Props {
  logs: AuditLogEntry[];
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  ORDER: "Заказ",
  RETURN: "Возврат",
  EXPENSE: "Расход",
  PRODUCT: "Товар",
  COUNTERPARTY: "Контрагент",
  USER: "Пользователь",
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  ORDER: "bg-primary/12 text-primary",
  RETURN: "bg-warning/12 text-warning",
  EXPENSE: "bg-destructive/12 text-destructive",
  PRODUCT: "bg-info/12 text-info",
  COUNTERPARTY: "bg-special/12 text-special",
  USER: "bg-success/12 text-success",
};

const FIELD_LABELS: Record<string, string> = {
  status: "Статус",
  trackingNumber: "Трек-номер",
  shippingDate: "Дата отправки",
  quantity: "Количество",
  salePriceAtOrder: "Цена продажи",
  destinationCity: "Город",
  isDeleted: "Удалён",
  returnReason: "Причина возврата",
  created: "Создано",
};

export function AuditLogClient({ logs }: Props) {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("ALL");

  const entityTypes = ["ALL", ...Array.from(new Set(logs.map((l) => l.entityType)))];

  const filtered = logs.filter((l) => {
    const matchEntity = entityFilter === "ALL" || l.entityType === entityFilter;
    const matchSearch =
      !search ||
      l.user.name.toLowerCase().includes(search.toLowerCase()) ||
      l.entityId.toLowerCase().includes(search.toLowerCase()) ||
      (l.newValue ?? "").toLowerCase().includes(search.toLowerCase());
    return matchEntity && matchSearch;
  });

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/settings" className="icon-tile h-9 w-9"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Журнал аудита</h1>
            <p className="section-caption">{filtered.length} записей</p>
          </div>
        </div>

        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по пользователю, ID..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Entity type filter chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {entityTypes.map((type) => (
            <button
              key={type}
              onClick={() => setEntityFilter(type)}
              className={`filter-chip flex-shrink-0 ${
                entityFilter === type
                  ? "filter-chip-active"
                  : ""
              }`}
            >
              {type === "ALL" ? "Все" : (ENTITY_TYPE_LABELS[type] ?? type)}
            </button>
          ))}
        </div>
      </div>

      <div className="app-content space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Filter className="h-10 w-10 mx-auto mb-3 opacity-45" />
            <p className="text-sm font-semibold">Записей не найдено</p>
          </div>
        )}

        {filtered.map((log) => (
          <Card key={log.id}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${ENTITY_TYPE_COLORS[log.entityType] ?? "bg-muted text-muted-foreground"}`}>
                    {ENTITY_TYPE_LABELS[log.entityType] ?? log.entityType}
                  </span>
                  <span className="text-xs text-muted-foreground">{log.user.name}</span>
                </div>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatDateTime(log.timestamp)}</span>
              </div>

              <p className="text-sm">
                <span className="font-medium">{FIELD_LABELS[log.fieldName] ?? log.fieldName}:</span>{" "}
                {log.oldValue && (
                  <span className="line-through text-muted-foreground mr-1">{log.oldValue}</span>
                )}
                {log.oldValue && "→ "}
                <span className="font-medium">{log.newValue}</span>
              </p>

              <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">{log.entityId}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
