const TELEGRAM_INIT_DATA_KEY = "crmavito.telegram.initData";

interface TelegramClientWindow {
  Telegram?: { WebApp?: { initData?: string } };
  location?: { search?: string; hash?: string };
  sessionStorage?: Pick<Storage, "getItem" | "setItem">;
}

function readFromUrlPart(value: string | undefined): string {
  if (!value) return "";

  try {
    return new URLSearchParams(value.replace(/^[?#]/, "")).get("tgWebAppData")?.trim() ?? "";
  } catch {
    return "";
  }
}

export function readTelegramInitData(source: TelegramClientWindow): string {
  const sdkValue = source.Telegram?.WebApp?.initData?.trim();
  if (sdkValue) return sdkValue;

  const urlValue =
    readFromUrlPart(source.location?.search) || readFromUrlPart(source.location?.hash);
  if (urlValue) return urlValue;

  try {
    return source.sessionStorage?.getItem(TELEGRAM_INIT_DATA_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function preserveTelegramInitData(source: TelegramClientWindow): string {
  const initData =
    source.Telegram?.WebApp?.initData?.trim() ||
    readFromUrlPart(source.location?.search) ||
    readFromUrlPart(source.location?.hash);

  if (initData) {
    try {
      source.sessionStorage?.setItem(TELEGRAM_INIT_DATA_KEY, initData);
    } catch {
      // Some Telegram clients can disable sessionStorage. URL/SDK fallback still works.
    }
  }

  return initData ?? "";
}
