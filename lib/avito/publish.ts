import { fetchWithRetry } from "@/lib/avito/sync";
import { extractAvitoErrorText, getAvitoStockToken, type AvitoCredentials } from "@/lib/avito/stocks";

type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

export type AvitoXmlPublishResult = {
  endpoint: string;
  status: number;
  data: unknown;
};

function getPublishEndpoint() {
  return process.env.AVITO_XML_PUBLISH_URL?.trim() || "";
}

export async function publishAvitoXml(
  credentials: AvitoCredentials,
  xml: string,
  filename: string,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<AvitoXmlPublishResult> {
  const endpoint = getPublishEndpoint();
  if (!endpoint) {
    throw new Error(
      "Не настроен AVITO_XML_PUBLISH_URL. Укажите API-адрес публикации XML для автозагрузки Avito на сервере.",
    );
  }

  const token = await getAvitoStockToken(credentials, options);
  const form = new FormData();
  form.append("file", new Blob([xml], { type: "application/xml" }), filename);

  const response = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    },
    options,
  );
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(`Публикация XML в Avito не прошла: ${extractAvitoErrorText(data).slice(0, 500)}`);
  }

  return { endpoint, status: response.status, data };
}
