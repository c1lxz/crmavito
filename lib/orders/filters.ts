const ORDER_FILTER_KEYS = ["q", "status", "dateFrom", "dateTo"] as const;

export interface OrderFilterValues {
  q?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function buildOrderFilterQuery(filters: OrderFilterValues): string {
  const params = new URLSearchParams();
  for (const key of ORDER_FILTER_KEYS) {
    const value = filters[key]?.trim();
    if (value && !(key === "status" && value === "ALL")) {
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
