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

export type AvitoAutoloadProfileSnapshot = {
  enabled: boolean;
  feeds: Array<{ name: string; url: string }>;
  reportEmail?: string;
};

type PublishOptions = {
  feedUrl: string;
  fetchFn?: FetchFn;
  sleepFn?: SleepFn;
  feedName?: string;
  reportEmail?: string;
};

type StopOptions = {
  fetchFn?: FetchFn;
  sleepFn?: SleepFn;
  reportEmail?: string;
};

export type AvitoXmlPublishResult = {
  feedUrl: string;
  profileStatus?: number;
  profileWarning?: string;
  uploadStatus: number;
  upload: unknown;
};

export type AvitoAutoloadStatus = {
  current: unknown | null;
  lastSuccessful: unknown | null;
  uploads: unknown[];
};

const DEFAULT_AUTOLOAD_TIMEOUT_MS = 120_000;

function autoloadTimeoutMs(): number {
  const value = Number(process.env.AVITO_AUTOLOAD_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 30_000 ? value : DEFAULT_AUTOLOAD_TIMEOUT_MS;
}

function autoloadSignal() {
  return AbortSignal.timeout(autoloadTimeoutMs());
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown };
  const text = `${String(record.name ?? "")} ${String(record.message ?? "")}`;
  return /timeout|aborted due to timeout|operation was aborted/i.test(text);
}

function formatAutoloadTransportError(error: unknown, action: string): Error {
  if (isTimeoutError(error)) {
    return new Error(
      `${action}: Avito не ответил за ${Math.round(autoloadTimeoutMs() / 1000)} секунд. Попробуйте запустить публикацию ещё раз и затем проверить статус автозагрузки.`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function fetchAutoload(
  url: string,
  init: RequestInit,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn },
  action: string,
): Promise<Response> {
  try {
    return await fetchWithRetry(
      url,
      {
        ...init,
        signal: autoloadSignal(),
      },
      options,
    );
  } catch (error) {
    throw formatAutoloadTransportError(error, action);
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function reportEmailFrom(profile: AutoloadProfile | null, explicitEmail?: string): string {
  const email =
    explicitEmail?.trim() ||
    profile?.report_email?.trim() ||
    process.env.AVITO_AUTOLOAD_REPORT_EMAIL?.trim();
  if (!email) {
    throw new Error(
      "Avito не дал прочитать профиль автозагрузки, поэтому нужен email для отчётов. Укажите его в поле публикации или в настройке AVITO_AUTOLOAD_REPORT_EMAIL на сервере.",
    );
  }
  return email;
}

function buildProfilePayload(profile: AutoloadProfile | null, feed: AutoloadFeed, explicitEmail?: string) {
  return {
    agreement: true,
    autoload_enabled: true,
    feeds_data: [feed],
    report_email: reportEmailFrom(profile, explicitEmail),
    schedule: profile?.schedule ?? [],
  };
}

function buildStoppedProfilePayload(profile: AutoloadProfile | null, explicitEmail?: string) {
  return {
    agreement: true,
    autoload_enabled: false,
    feeds_data: [],
    report_email: reportEmailFrom(profile, explicitEmail),
    schedule: profile?.schedule ?? [],
  };
}

function isAutoloadProfileUpdateUnavailable(status: number, data: unknown): boolean {
  const errorText = extractAvitoErrorText(data);
  return status === 403 && errorText.includes("Создание/обновление профиля недоступно");
}

function profileHasFeed(profile: AutoloadProfile | null, feedUrl: string): boolean {
  return Boolean(
    profile?.autoload_enabled &&
      profile.feeds_data?.some((feed) => feed.feed_url?.trim() === feedUrl),
  );
}

async function getAutoloadProfile(
  token: string,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<AutoloadProfile | null> {
  const response = await fetchAutoload(
    "https://api.avito.ru/autoload/v2/profile",
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
    options,
    "Получение профиля автозагрузки Avito",
  );

  if (response.status === 404) return null;
  const data = await readJsonResponse(response);
  if (!response.ok) {
    const errorText = extractAvitoErrorText(data);
    if (response.status === 403 && errorText.includes("Получение профиля недоступно")) {
      return null;
    }
    throw new Error(`Получение профиля автозагрузки Avito не прошло: ${extractAvitoErrorText(data).slice(0, 500)}`);
  }
  return data as AutoloadProfile;
}

export async function fetchAvitoAutoloadProfile(
  credentials: AvitoCredentials,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<AvitoAutoloadProfileSnapshot> {
  const token = await getAvitoStockToken(credentials, options);
  const profile = await getAutoloadProfile(token, options);
  return {
    enabled: Boolean(profile?.autoload_enabled),
    feeds: (profile?.feeds_data ?? []).map((feed) => ({
      name: feed.feed_name ?? "",
      url: feed.feed_url ?? "",
    })).filter((feed) => Boolean(feed.url)),
    reportEmail: profile?.report_email?.trim() || undefined,
  };
}

async function upsertAutoloadProfile(
  token: string,
  profile: AutoloadProfile | null,
  feed: AutoloadFeed,
  options: PublishOptions,
): Promise<{ status?: number; warning?: string }> {
  const response = await fetchAutoload(
    "https://api.avito.ru/autoload/v2/profile",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildProfilePayload(profile, feed, options.reportEmail)),
      cache: "no-store",
    },
    options,
    "Настройка фида автозагрузки Avito",
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    if (isAutoloadProfileUpdateUnavailable(response.status, data)) {
      if (profileHasFeed(profile, feed.feed_url)) {
        return {
          warning: "Avito не разрешил обновить профиль автозагрузки через API, но нужный XML-фид уже указан в кабинете. Запускаю выгрузку по сохранённой ссылке.",
        };
      }
      throw new Error(
        [
          "Настройка фида автозагрузки Avito не прошла: Avito не разрешил создать или обновить профиль через API.",
          "Откройте Автозагрузку в кабинете Avito и добавьте эту ссылку на XML-фид:",
          feed.feed_url,
          "После сохранения ссылки снова нажмите публикацию в CRM.",
        ].join(" "),
      );
    }
    throw new Error(`Настройка фида автозагрузки Avito не прошла: ${extractAvitoErrorText(data).slice(0, 500)}`);
  }
  return { status: response.status };
}

async function startAutoloadUpload(
  token: string,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<{ status: number; data: unknown }> {
  const response = await fetchAutoload(
    "https://api.avito.ru/autoload/v1/upload",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
    options,
    "Запуск автозагрузки Avito",
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Запуск автозагрузки Avito не прошёл: ${extractAvitoErrorText(data).slice(0, 500)}`);
  }
  return { status: response.status, data };
}

async function getOptionalAutoloadData(
  token: string,
  path: string,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<unknown | null> {
  const response = await fetchAutoload(
    `https://api.avito.ru${path}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
    options,
    "Получение статуса автозагрузки Avito",
  );
  const data = await readJsonResponse(response);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Получение статуса автозагрузки Avito не прошло: ${extractAvitoErrorText(data).slice(0, 500)}`);
  }
  return data;
}

export async function fetchAvitoAutoloadStatus(
  credentials: AvitoCredentials,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<AvitoAutoloadStatus> {
  const token = await getAvitoStockToken(credentials, options);
  const [current, lastSuccessful, uploadsData] = await Promise.all([
    getOptionalAutoloadData(token, "/autoload/v4/uploads/current", options),
    getOptionalAutoloadData(token, "/autoload/v4/uploads/last_successful", options),
    getOptionalAutoloadData(token, "/autoload/v4/uploads?perPage=5&page=1", options),
  ]);
  const uploads = uploadsData && typeof uploadsData === "object" && Array.isArray((uploadsData as { uploads?: unknown[] }).uploads)
    ? (uploadsData as { uploads: unknown[] }).uploads
    : [];

  return { current, lastSuccessful, uploads };
}

export async function disableAvitoAutoload(
  credentials: AvitoCredentials,
  options: StopOptions = {},
): Promise<{ profileStatus: number }> {
  const token = await getAvitoStockToken(credentials, options);
  const profile = await getAutoloadProfile(token, options);
  const response = await fetchAutoload(
    "https://api.avito.ru/autoload/v2/profile",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildStoppedProfilePayload(profile, options.reportEmail)),
      cache: "no-store",
    },
    options,
    "Остановка автозагрузки Avito",
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Остановка автозагрузки Avito не прошла: ${extractAvitoErrorText(data).slice(0, 500)}`);
  }
  return { profileStatus: response.status };
}

export async function publishAvitoXml(
  credentials: AvitoCredentials,
  xml: string,
  filename: string,
  options: PublishOptions,
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
  const profileResult = await upsertAutoloadProfile(token, profile, feed, options);
  const upload = await startAutoloadUpload(token, options);

  return {
    feedUrl,
    profileStatus: profileResult.status,
    profileWarning: profileResult.warning,
    uploadStatus: upload.status,
    upload: upload.data,
  };
}
