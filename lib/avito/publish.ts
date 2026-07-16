import { fetchWithRetry } from "@/lib/avito/sync";
import { extractAvitoErrorText, getAvitoStockToken, type AvitoCredentials } from "@/lib/avito/stocks";

type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

type AutoloadFeed = {
  feed_name: string;
  feed_url: string;
};

type AutoloadScheduleItem = {
  rate: number;
  time_slots: number[];
  weekdays: number[];
};

type AutoloadProfile = {
  autoload_enabled?: boolean;
  feeds_data?: AutoloadFeed[] | null;
  report_email?: string | null;
  schedule?: AutoloadScheduleItem[];
};

export type AvitoXmlPublishResult = {
  feedUrl: string;
  profileStatus: number;
  uploadStatus: number;
  upload: unknown;
};

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function reportEmailFrom(profile: AutoloadProfile | null): string {
  const email = profile?.report_email?.trim() || process.env.AVITO_AUTOLOAD_REPORT_EMAIL?.trim();
  if (!email) {
    throw new Error(
      "В профиле автозагрузки Avito не указан email для отчётов. Укажите его в настройках автозагрузки Avito или задайте AVITO_AUTOLOAD_REPORT_EMAIL на сервере.",
    );
  }
  return email;
}

function buildProfilePayload(profile: AutoloadProfile | null, feed: AutoloadFeed) {
  return {
    agreement: true,
    autoload_enabled: true,
    feeds_data: [feed],
    report_email: reportEmailFrom(profile),
    schedule: profile?.schedule ?? [],
  };
}

async function getAutoloadProfile(
  token: string,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<AutoloadProfile | null> {
  const response = await fetchWithRetry(
    "https://api.avito.ru/autoload/v2/profile",
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
    options,
  );

  if (response.status === 404) return null;
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Получение профиля автозагрузки Avito не прошло: ${extractAvitoErrorText(data).slice(0, 500)}`);
  }
  return data as AutoloadProfile;
}

async function upsertAutoloadProfile(
  token: string,
  profile: AutoloadProfile | null,
  feed: AutoloadFeed,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<number> {
  const response = await fetchWithRetry(
    "https://api.avito.ru/autoload/v2/profile",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildProfilePayload(profile, feed)),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
    options,
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Настройка фида автозагрузки Avito не прошла: ${extractAvitoErrorText(data).slice(0, 500)}`);
  }
  return response.status;
}

async function startAutoloadUpload(
  token: string,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<{ status: number; data: unknown }> {
  const response = await fetchWithRetry(
    "https://api.avito.ru/autoload/v1/upload",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
    options,
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Запуск автозагрузки Avito не прошёл: ${extractAvitoErrorText(data).slice(0, 500)}`);
  }
  return { status: response.status, data };
}

export async function publishAvitoXml(
  credentials: AvitoCredentials,
  xml: string,
  filename: string,
  options: { feedUrl: string; fetchFn?: FetchFn; sleepFn?: SleepFn; feedName?: string },
): Promise<AvitoXmlPublishResult> {
  if (!xml.trim()) throw new Error("XML пустой, публикация Avito не запущена.");
  const feedUrl = options.feedUrl.trim();
  if (!/^https?:\/\//i.test(feedUrl)) {
    throw new Error("Для автозагрузки Avito нужен публичный URL XML-фида.");
  }

  const token = await getAvitoStockToken(credentials, options);
  const feed = {
    feed_name: options.feedName?.trim() || filename || "crmavito.xml",
    feed_url: feedUrl,
  };
  const profile = await getAutoloadProfile(token, options);
  const profileStatus = await upsertAutoloadProfile(token, profile, feed, options);
  const upload = await startAutoloadUpload(token, options);

  return {
    feedUrl,
    profileStatus,
    uploadStatus: upload.status,
    upload: upload.data,
  };
}
