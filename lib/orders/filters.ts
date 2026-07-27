const ORDER_FILTER_KEYS = [
  "q",
  "status",
  "counterpartyId",
  "avitoProfileId",
  "marketplace",
  "dateFrom",
  "dateTo",
] as const;

export interface OrderFilterValues {
  q?: string;
  status?: string;
  counterpartyId?: string;
  avitoProfileId?: string;
  marketplace?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function buildOrderFilterQuery(filters: OrderFilterValues): string {
  const params = new URLSearchParams();
  for (const key of ORDER_FILTER_KEYS) {
    const value = filters[key]?.trim();
    const isInactiveChoice =
      (key === "status" || key === "counterpartyId" || key === "avitoProfileId" || key === "marketplace") &&
      value === "ALL";
    if (value && !isInactiveChoice) {
      params.set(key, value);
    }
  }
  return params.toString();
}

export function sanitizeOrderFilterQuery(query: string): string {
  const requested = new URLSearchParams(query);
  return buildOrderFilterQuery(
    Object.fromEntries(
      ORDER_FILTER_KEYS.map((key) => [key, requested.get(key) ?? undefined]),
    ),
  );
}
