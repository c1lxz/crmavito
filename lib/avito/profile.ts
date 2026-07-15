import { fetchWithRetry } from "@/lib/avito/sync";
import { extractAvitoErrorText, getAvitoStockToken, type AvitoCredentials } from "@/lib/avito/stocks";

type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

export type AvitoAccountProfile = {
  id: string;
  name: string;
};

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export async function fetchAvitoAccountProfile(
  credentials: AvitoCredentials,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<AvitoAccountProfile> {
  const token = await getAvitoStockToken(credentials, options);
  const response = await fetchWithRetry(
    "https://api.avito.ru/core/v1/accounts/self",
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
    options,
  );
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Получение профиля Avito не прошло: ${extractAvitoErrorText(data).slice(0, 300)}`);
  }

  const profile = (data.profile && typeof data.profile === "object" ? data.profile : {}) as Record<string, unknown>;
  const id = firstString(data.id, data.user_id, data.account_id, profile.id) ?? "unknown";
  const name =
    firstString(data.name, data.company_name, data.login, profile.name, profile.title, profile.url) ??
    `Avito ${id}`;

  return { id, name };
}
